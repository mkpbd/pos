<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Queries\ListingEditor;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

/**
 * Creates or updates a brand's web listing (address, visibility, logo, description, SEO).
 */
class SaveBrandListing
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly MediaLibrary $media,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated
     */
    public function __invoke(string $brandId, array $data): BrandListing
    {
        $brand = $this->catalog->brands()[$brandId]
            ?? throw (new ModelNotFoundException)->setModel(BrandListing::class, [$brandId]);

        ListingMedia::assertExist($this->media, [$data['logo_media_id'] ?? null]);

        return DB::transaction(function () use ($brandId, $brand, $data) {
            $listing = BrandListing::query()->where('brand_id', $brandId)->lockForUpdate()->first();
            $creating = $listing === null;
            $listing ??= new BrandListing(['brand_id' => $brandId]);
            $before = $creating ? [] : $listing->only(ListingMedia::AUDITED_BRAND);

            $slug = isset($data['slug']) && $data['slug'] !== '' ? $data['slug'] : null;
            unset($data['slug']);
            $listing->fill(ListingMedia::blankToNull($data));
            $listing->slug = $slug ?? $listing->slug ?? ListingEditor::suggestSlug($brand['name'], BrandListing::class, $listing->id);
            $listing->save();

            [$old, $new] = Changes::between($before, $listing->only(ListingMedia::AUDITED_BRAND));
            if ($creating || $new !== []) {
                $this->audit->record('online_catalog.brand_listing.saved', $listing, $old, $new);
            }

            return $listing;
        });
    }
}
