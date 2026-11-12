<?php

namespace App\Modules\Reviews\Infrastructure;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Reviews\Domain\ReviewAuthor;
use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * B8a: approved reviews for the store builder (tenant-scoped through the Review model). Large
 * product lists are queried in chunks (bind parameter limits): each chunk's best `$limit`
 * reviews are merged and cut again, which gives the same result as one query.
 */
class EloquentReviewShowcase implements ReviewShowcase
{
    private const CHUNK = 5000;

    public function __construct(
        private readonly CustomerDirectory $customers,
        private readonly TenantContext $tenant,
    ) {}

    public function approved(array $productIds, int $minRating, string $order, int $limit, int $bodyMax): array
    {
        $productIds = array_values(array_unique($productIds));
        if ($productIds === [] || $limit < 1) {
            return [];
        }

        $reviews = [];
        foreach (array_chunk($productIds, self::CHUNK) as $chunk) {
            $query = Review::query()->whereIn('product_id', $chunk)
                ->where('status', ReviewStatus::Approved->value)
                ->where('rating', '>=', $minRating);
            if ($order === 'top_rated') {
                $query->orderByDesc('rating');
            }
            array_push($reviews, ...$query->orderByDesc('created_at')->orderByDesc('id')->limit($limit)->get()->all());
        }
        usort($reviews, fn (Review $a, Review $b) => ($order === 'top_rated' ? $b->rating <=> $a->rating : 0)
            ?: ($b->created_at <=> $a->created_at)
            ?: strcmp($b->id, $a->id));
        $reviews = array_slice($reviews, 0, $limit);
        if ($reviews === []) {
            return [];
        }

        $names = $this->customers->summaries($this->tenant->requireOrganization(), array_values(array_unique(array_map(fn (Review $r) => $r->customer_id, $reviews))));

        return array_map(fn (Review $r) => [
            'id' => $r->id,
            'product_id' => $r->product_id,
            'author' => ReviewAuthor::publicName($names[$r->customer_id]['name'] ?? null),
            'rating' => $r->rating,
            'title' => $r->title,
            'body' => self::excerpt($r->body, $bodyMax),
            'created_at' => $r->created_at->toIso8601String(),
        ], $reviews);
    }

    public function ratingCounts(array $productIds): array
    {
        $counts = ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 0];
        foreach (array_chunk(array_values(array_unique($productIds)), self::CHUNK) as $chunk) {
            $rows = Review::query()->whereIn('product_id', $chunk)->where('status', ReviewStatus::Approved->value)
                ->groupBy('rating')->select('rating', DB::raw('count(*) as n'))->toBase()->get();
            foreach ($rows as $row) {
                $key = (string) (int) $row->rating;
                if (isset($counts[$key])) {
                    $counts[$key] += (int) $row->n;
                }
            }
        }

        return $counts;
    }

    /**
     * Plain text (a review body is never HTML): whitespace collapsed, at most `$max`
     * characters, cut at a word boundary with an ellipsis.
     */
    private static function excerpt(string $text, int $max): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));
        if (mb_strlen($text) <= $max) {
            return $text;
        }
        $cut = mb_substr($text, 0, $max - 1);
        $space = mb_strrpos($cut, ' ');
        if ($space !== false && $space > $max / 2) {
            $cut = mb_substr($cut, 0, $space);
        }

        return rtrim($cut, ' ,.;:-').'…';
    }
}
