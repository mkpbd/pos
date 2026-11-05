<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Queries\ListingEditor;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\TranslationInput;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

/**
 * Creates or updates a category's web listing (address, visibility, images, description, SEO).
 */
class SaveCategoryListing
{
    /** E12b: translatable texts with the limits of their base fields (name: the category's). */
    public const TRANSLATABLE = [
        'name' => ['max:100'],
        'description_html' => ['max:50000'],
        'seo_title' => ['max:70'],
        'seo_description' => ['max:160'],
    ];

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly MediaLibrary $media,
        private readonly HtmlSanitizer $sanitizer,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated
     */
    public function __invoke(string $categoryId, array $data): CategoryListing
    {
        $node = $this->catalog->categoryTree()->node($categoryId)
            ?? throw (new ModelNotFoundException)->setModel(CategoryListing::class, [$categoryId]);

        ListingMedia::assertExist($this->media, [$data['image_media_id'] ?? null, $data['banner_media_id'] ?? null]);
        if (array_key_exists('description_html', $data)) {
            $html = $data['description_html'] === null ? '' : $this->sanitizer->clean((string) $data['description_html']);
            $data['description_html'] = trim(strip_tags($html, '<img>')) === '' ? null : $html;
        }

        return DB::transaction(function () use ($categoryId, $node, $data) {
            $listing = CategoryListing::query()->where('category_id', $categoryId)->lockForUpdate()->first();
            $creating = $listing === null;
            $listing ??= new CategoryListing(['category_id' => $categoryId]);
            $before = $creating ? [] : $listing->only(ListingMedia::AUDITED_CATEGORY);

            $slug = isset($data['slug']) && $data['slug'] !== '' ? $data['slug'] : null;
            unset($data['slug']);
            if (array_key_exists('translations', $data)) {
                $data['translations'] = TranslationInput::apply($listing->translations, $data['translations'], array_keys(self::TRANSLATABLE), ['description_html'], $this->sanitizer);
            }
            $listing->fill(ListingMedia::blankToNull($data));
            $listing->slug = $slug ?? $listing->slug ?? ListingEditor::suggestSlug($node['name'], CategoryListing::class, $listing->id);
            $listing->save();

            [$old, $new] = Changes::between($before, $listing->only(ListingMedia::AUDITED_CATEGORY));
            if ($creating || $new !== []) {
                $this->audit->record('online_catalog.category_listing.saved', $listing, $old, $new);
            }

            return $listing;
        });
    }
}
