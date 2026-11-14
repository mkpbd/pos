<?php

namespace App\Modules\Reviews\Presentation\Http\Support;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Reviews\Domain\ReviewAuthor;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * P1b: shopper questions for the product page (the asker's first name and last initial only,
 * never the e-mail) and for staff.
 */
class QuestionPresenter
{
    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * Public: `{id, name, question, answer, asked_at, answered_at}`.
     *
     * @param  list<ProductQuestion>  $questions
     * @return list<array<string, mixed>>
     */
    public function public(array $questions): array
    {
        return array_map(fn (ProductQuestion $q) => [
            'id' => $q->id,
            'name' => ReviewAuthor::publicName($q->name),
            'question' => $q->question,
            'answer' => $q->answer,
            'asked_at' => $q->created_at->toIso8601String(),
            'answered_at' => $q->answered_at?->toIso8601String(),
        ], $questions);
    }

    /**
     * Staff: `{id, product: {id, name, slug}, name, email, question, answer, status, locale,
     * created_at, answered_at, answered_by_name}` (`slug` while the product is live).
     *
     * @param  list<ProductQuestion>  $questions
     * @return list<array<string, mixed>>
     */
    public function staff(array $questions): array
    {
        $products = $this->catalog->productSummaries(array_values(array_unique(array_map(fn (ProductQuestion $q) => $q->product_id, $questions))));
        $names = $this->users->names($this->tenant->requireOrganization(), array_values(array_unique(array_filter(array_map(fn (ProductQuestion $q) => $q->answered_by, $questions)))));

        return array_map(fn (ProductQuestion $q) => [
            'id' => $q->id,
            'product' => [
                'id' => $q->product_id,
                'name' => $products[$q->product_id]['name'] ?? null,
                'slug' => $products[$q->product_id]['slug'] ?? null,
            ],
            'name' => $q->name,
            'email' => $q->email,
            'question' => $q->question,
            'answer' => $q->answer,
            'status' => $q->status->value,
            'locale' => $q->locale,
            'created_at' => $q->created_at->toIso8601String(),
            'answered_at' => $q->answered_at?->toIso8601String(),
            'answered_by_name' => $q->answered_by === null ? null : ($names[$q->answered_by] ?? null),
        ], $questions);
    }
}
