<?php

namespace App\Modules\Reviews\Presentation\Http\Support;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Reviews\Domain\ReviewAuthor;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * Shapes reviews for their author, the product page (first name + last initial only) and staff.
 */
class ReviewPresenter
{
    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly CustomerDirectory $customers,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * The author's view: `{id, product: {id, name, slug, image_url}, rating, title, body,
     * status, status_label, rejection_reason, verified, created_at, updated_at}`.
     *
     * @param  list<Review>  $reviews
     * @return list<array<string, mixed>>
     */
    public function own(array $reviews): array
    {
        $products = $this->catalog->productSummaries(array_map(fn (Review $r) => $r->product_id, $reviews));

        return array_map(fn (Review $r) => [
            'id' => $r->id,
            'product' => $products[$r->product_id] ?? ['id' => $r->product_id, 'name' => null, 'slug' => null, 'image_url' => null],
            'rating' => $r->rating,
            'title' => $r->title,
            'body' => $r->body,
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'rejection_reason' => $r->rejection_reason,
            'verified' => true,
            'created_at' => $r->created_at->toIso8601String(),
            'updated_at' => $r->updated_at->toIso8601String(),
        ], $reviews);
    }

    /**
     * Public: `{id, rating, title, body, author, created_at, verified: true}`.
     *
     * @param  list<Review>  $reviews
     * @return list<array<string, mixed>>
     */
    public function public(array $reviews): array
    {
        $customers = $this->customers->summaries($this->tenant->requireOrganization(), array_map(fn (Review $r) => $r->customer_id, $reviews));

        return array_map(fn (Review $r) => [
            'id' => $r->id,
            'rating' => $r->rating,
            'title' => $r->title,
            'body' => $r->body,
            'author' => ReviewAuthor::publicName($customers[$r->customer_id]['name'] ?? null),
            'created_at' => $r->created_at->toIso8601String(),
            'verified' => true,
        ], $reviews);
    }

    /**
     * Staff: `{id, product: {id, name}, customer: {id, name, email}, rating, title, body,
     * status, created_at, moderated_at, moderated_by_name, rejection_reason}`.
     *
     * @param  list<Review>  $reviews
     * @return list<array<string, mixed>>
     */
    public function staff(array $reviews): array
    {
        $org = $this->tenant->requireOrganization();
        $products = $this->catalog->productSummaries(array_map(fn (Review $r) => $r->product_id, $reviews));
        $customers = $this->customers->summaries($org, array_map(fn (Review $r) => $r->customer_id, $reviews));
        $names = $this->users->names($org, array_values(array_unique(array_filter(array_map(fn (Review $r) => $r->moderated_by, $reviews)))));

        return array_map(fn (Review $r) => [
            'id' => $r->id,
            'product' => ['id' => $r->product_id, 'name' => $products[$r->product_id]['name'] ?? null],
            'customer' => [
                'id' => $r->customer_id,
                'name' => $customers[$r->customer_id]['name'] ?? null,
                'email' => $customers[$r->customer_id]['email'] ?? null,
            ],
            'rating' => $r->rating,
            'title' => $r->title,
            'body' => $r->body,
            'status' => $r->status->value,
            'created_at' => $r->created_at->toIso8601String(),
            'moderated_at' => $r->moderated_at?->toIso8601String(),
            'moderated_by_name' => $r->moderated_by === null ? null : ($names[$r->moderated_by] ?? null),
            'rejection_reason' => $r->rejection_reason,
        ], $reviews);
    }
}
