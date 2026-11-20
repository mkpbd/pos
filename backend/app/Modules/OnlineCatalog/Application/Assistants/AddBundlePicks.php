<?php

namespace App\Modules\OnlineCatalog\Application\Assistants;

use App\Modules\OnlineCatalog\Application\Actions\SaveRelatedProducts;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * AI2a: "Add to frequently bought together" from a bundle idea — appends products to the
 * anchor's hand-picked list through SaveRelatedProducts (same checks and audit), keeping the
 * existing picks and the "related" list, skipping products already picked, at most
 * RelatedProduct::MAX_PER_KIND in all (422 TOO_MANY_PICKS).
 */
class AddBundlePicks
{
    public function __construct(private readonly SaveRelatedProducts $save) {}

    /**
     * @param  list<string>  $productIds
     * @return list<string> the products added (in order)
     */
    public function __invoke(string $organizationId, string $anchorId, array $productIds): array
    {
        $anchorId = strtolower($anchorId);
        $productIds = array_values(array_unique(array_map('strtolower', $productIds)));
        if (in_array($anchorId, $productIds, true)) {
            throw ValidationException::withMessages(['product_ids' => ['A product cannot be bought together with itself.']]);
        }

        return DB::transaction(function () use ($organizationId, $anchorId, $productIds) {
            // One change of the anchor's picks at a time.
            $locked = DB::table('products')->where('organization_id', $organizationId)->where('id', $anchorId)->whereNull('deleted_at')->lockForUpdate()->value('id');
            if ($locked === null) {
                throw (new ModelNotFoundException)->setModel(ProductListing::class, [$anchorId]);
            }

            $lists = array_fill_keys(RelatedProduct::KINDS, []);
            foreach (RelatedProduct::query()->where('product_id', $anchorId)->orderBy('sort_order')->get() as $row) {
                $lists[$row->kind][] = (string) $row->related_product_id;
            }
            $added = array_values(array_diff($productIds, $lists['frequently_bought']));
            if ($added === []) {
                return [];
            }
            $room = RelatedProduct::MAX_PER_KIND - count($lists['frequently_bought']);
            if (count($added) > $room) {
                throw new BusinessRuleViolation('TOO_MANY_PICKS', 'This product already has '.count($lists['frequently_bought']).' "frequently bought together" picks (at most '.RelatedProduct::MAX_PER_KIND.'). Remove some first.', ['limit' => RelatedProduct::MAX_PER_KIND, 'room' => max(0, $room)]);
            }

            $lists['frequently_bought'] = [...$lists['frequently_bought'], ...$added];
            ($this->save)($anchorId, $lists);

            return $added;
        });
    }
}
