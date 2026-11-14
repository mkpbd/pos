<?php

namespace App\Modules\Reviews\Application\Queries;

use App\Modules\Reviews\Domain\QuestionStatus;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * P1b: shopper questions — the product page's published ones, their count, and the staff queue.
 * Every query is inside the organization in context (tenant scope).
 */
class ProductQuestionQueries
{
    public const PUBLIC_PER_PAGE = 10;

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Published questions of a product, latest answer first.
     *
     * @return LengthAwarePaginator<int, ProductQuestion>
     */
    public function publishedOf(string $productId, int $page): LengthAwarePaginator
    {
        return ProductQuestion::query()->where('product_id', $productId)->where('status', QuestionStatus::Published->value)
            ->orderByDesc('answered_at')->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(self::PUBLIC_PER_PAGE, ['*'], 'page', max(1, $page));
    }

    public function publishedCount(string $productId): int
    {
        return ProductQuestion::query()->where('product_id', $productId)->where('status', QuestionStatus::Published->value)->count();
    }

    /**
     * Staff list: pending first, then newest. `search` matches the question, the answer, the
     * asker's name or e-mail and the product name; `product` keeps one product's questions.
     *
     * @param  array{status?: ?string, search?: ?string, product?: ?string}  $filters
     * @return LengthAwarePaginator<int, ProductQuestion>
     */
    public function forStaff(array $filters, int $page, int $perPage): LengthAwarePaginator
    {
        $org = $this->tenant->requireOrganization();
        $query = ProductQuestion::query()
            ->when($filters['status'] ?? null, fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($filters['product'] ?? null, fn (Builder $q, string $v) => $q->where('product_id', $v));

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $like = '%'.addcslashes(mb_strtolower($search), '%_\\').'%';
            $query->where(fn (Builder $q) => $q
                ->whereRaw('lower(question) like ?', [$like])
                ->orWhereRaw('lower(answer) like ?', [$like])
                ->orWhereRaw('lower(name) like ?', [$like])
                ->orWhereRaw('lower(email) like ?', [$like])
                // Read-only lookup of the product names the list shows.
                ->orWhereIn('product_id', DB::table('products')->where('organization_id', $org)->whereRaw('lower(name) like ?', [$like])->select('id')));
        }

        return $query
            ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate($perPage, ['*'], 'page', max(1, $page));
    }

    public function pendingCount(): int
    {
        return ProductQuestion::query()->where('status', QuestionStatus::Pending->value)->count();
    }
}
