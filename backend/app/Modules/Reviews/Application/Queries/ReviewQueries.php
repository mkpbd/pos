<?php

namespace App\Modules\Reviews\Application\Queries;

use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Review lists and the rating summary. All queries are inside the organization in context
 * (tenant scope). The summary is an aggregate over approved reviews, computed per request
 * (no cache in E9 — fine for the size target).
 */
class ReviewQueries
{
    public const PUBLIC_PER_PAGE = 10;

    public const SORTS = ['newest', 'highest', 'lowest'];

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @return LengthAwarePaginator<int, Review>
     */
    public function ofCustomer(string $customerId, int $page, int $perPage = 20): LengthAwarePaginator
    {
        return Review::query()->where('customer_id', $customerId)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate($perPage, ['*'], 'page', max(1, $page));
    }

    /**
     * Approved reviews of a product.
     *
     * @return LengthAwarePaginator<int, Review>
     */
    public function approvedOf(string $productId, string $sort, ?int $rating, int $page): LengthAwarePaginator
    {
        $query = Review::query()->where('product_id', $productId)->where('status', ReviewStatus::Approved->value)
            ->when($rating !== null, fn (Builder $q) => $q->where('rating', $rating));
        match ($sort) {
            'highest' => $query->orderByDesc('rating')->orderByDesc('created_at'),
            'lowest' => $query->orderBy('rating')->orderByDesc('created_at'),
            default => $query->orderByDesc('created_at'),
        };

        return $query->orderByDesc('id')->paginate(self::PUBLIC_PER_PAGE, ['*'], 'page', max(1, $page));
    }

    /**
     * Rating summaries of many products in one grouped query (E10b: product cards and the
     * "top rated" sort). Products without approved reviews are absent.
     *
     * @param  list<string>  $productIds
     * @return array<string, array{average: string, count: int}>
     */
    public function summaries(array $productIds): array
    {
        $result = [];
        foreach (array_chunk(array_values(array_unique($productIds)), 500) as $chunk) {
            $rows = Review::query()->whereIn('product_id', $chunk)->where('status', ReviewStatus::Approved->value)
                ->groupBy('product_id')
                ->select('product_id', DB::raw('count(*) as n'), DB::raw('sum(rating) as total'))
                ->toBase()->get();
            foreach ($rows as $row) {
                $count = (int) $row->n;
                $result[(string) $row->product_id] = ['average' => Decimal::div((string) $row->total, (string) $count, 1), 'count' => $count];
            }
        }

        return $result;
    }

    /**
     * @return array{average: ?string, count: int, distribution: array<string, int>}
     */
    public function summary(string $productId): array
    {
        $counts = Review::query()->where('product_id', $productId)->where('status', ReviewStatus::Approved->value)
            ->groupBy('rating')->select('rating', DB::raw('count(*) as n'))->pluck('n', 'rating')->all();

        $distribution = [];
        $total = 0;
        $sum = 0;
        foreach ([1, 2, 3, 4, 5] as $stars) {
            $n = (int) ($counts[$stars] ?? 0);
            $distribution[(string) $stars] = $n;
            $total += $n;
            $sum += $n * $stars;
        }

        return [
            'average' => $total === 0 ? null : Decimal::div((string) $sum, (string) $total, 1),
            'count' => $total,
            'distribution' => $distribution,
        ];
    }

    /**
     * Staff list: pending first, then newest. `search` matches title, body, product name and
     * customer name or e-mail.
     *
     * @param  array{status?: ?string, rating?: ?int, search?: ?string}  $filters
     * @return LengthAwarePaginator<int, Review>
     */
    public function forStaff(array $filters, int $page, int $perPage): LengthAwarePaginator
    {
        return $this->staffQuery($filters)->paginate($perPage, ['*'], 'page', max(1, $page));
    }

    /**
     * The staff queue (pending first, newest first) — paged by forStaff(), exported in full.
     *
     * @param  array{status?: ?string, rating?: ?int, search?: ?string}  $filters
     * @return Builder<Review>
     */
    public function staffQuery(array $filters): Builder
    {
        $org = $this->tenant->requireOrganization();
        $query = Review::query()
            ->when($filters['status'] ?? null, fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($filters['rating'] ?? null, fn (Builder $q, int $v) => $q->where('rating', $v));

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $like = '%'.addcslashes($search, '%_\\').'%';
            $query->where(function (Builder $q) use ($like, $org) {
                $q->whereLike('title', $like)
                    ->orWhereLike('body', $like)
                    // Read-only lookups of the names the list shows (products, customers).
                    ->orWhereIn('product_id', DB::table('products')->where('organization_id', $org)->whereLike('name', $like)->select('id'))
                    ->orWhereIn('customer_id', DB::table('customers')->where('organization_id', $org)
                        ->where(fn ($c) => $c->whereLike('name', $like)->orWhereLike('email', $like))->select('id'));
            });
        }

        return $query
            ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")
            ->orderByDesc('created_at')->orderByDesc('id');
    }

    public function pendingCount(): int
    {
        return Review::query()->where('status', ReviewStatus::Pending->value)->count();
    }
}
