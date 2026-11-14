<?php

namespace App\Modules\Storefront\Application\Builder\Templates;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\Builder\Templates\TemplateReferenceResolver;
use App\Modules\Storefront\Domain\MenuLocation;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use Illuminate\Support\Facades\Validator;

/**
 * B5: resolves a built-in template's portable references for the current organization (one
 * instance per apply):
 *
 * - an image asset is imported into the organization's media library once — by asset key within
 *   the apply, and by content hash across applies (the media library reuses identical bytes), so
 *   applying templates again never duplicates photos; a photo the owner deleted is imported again;
 * - a banner is created through the banner action (active, unscheduled, last in its placement)
 *   unless the organization already has one with the same placement, name, title, link and image
 *   — what an earlier apply of the same template created — which is reused;
 * - a menu reference is the organization's active menu at that location (`footer`: the first
 *   footer column that has one), or null;
 * - B6: a product reference is the index-th live product of a homepage source (featured, best
 *   sellers, new arrivals, on sale), or null.
 */
class TemplateReferences implements TemplateReferenceResolver
{
    /** @var array<string, string> media ids by asset key */
    private array $media = [];

    /** @var array<string, ?string> menu ids by reference */
    private array $menus = [];

    private int $importedMedia = 0;

    private int $createdBanners = 0;

    private int $reusedBanners = 0;

    /** @var array<string, list<string>> live product ids by source */
    private array $products = [];

    /** @var array<string, ?string> promotion ids by reference */
    private array $promotions = [];

    /** P2a: the campaign page's product (`product_ref` source `landing`). */
    private ?string $landingProduct = null;

    public function __construct(
        private readonly BuilderTemplateLibrary $library,
        private readonly MediaLibrary $mediaLibrary,
        private readonly ManageBanners $banners,
        private readonly StorefrontCatalog $catalog,
        private readonly PromotionShowcase $showcase,
    ) {}

    /**
     * P2a: the product a new campaign page is made for (product reference source `landing`).
     */
    public function useLandingProduct(?string $productId): void
    {
        $this->landingProduct = $productId;
    }

    /**
     * B8b: `coupon` — the running coupon promotion with a usable code that ends first, or null.
     */
    public function promotion(string $ref): ?string
    {
        if (array_key_exists($ref, $this->promotions)) {
            return $this->promotions[$ref];
        }

        return $this->promotions[$ref] = $ref === 'coupon' ? $this->showcase->runningCouponPromotion() : null;
    }

    /**
     * B6: the index-th live product of a source (the homepage source order), or null.
     */
    public function product(string $source, int $index): ?string
    {
        if ($source === PortableTemplate::LANDING_SOURCE) {
            // P2a: the campaign page's product, else the store's first featured / best-selling / newest one.
            if ($this->landingProduct !== null) {
                return $this->landingProduct;
            }
            foreach (['featured', 'best_sellers', 'new_arrivals'] as $fallback) {
                if (($id = $this->product($fallback, $index)) !== null) {
                    return $id;
                }
            }

            return null;
        }
        if (! in_array($source, PortableTemplate::PRODUCT_SOURCES, true)) {
            return null;
        }
        $this->products[$source] ??= array_values(array_filter(array_column($this->catalog->sourceProductCards($source, null, PortableTemplate::PRODUCT_REF_MAX), 'id'), 'is_string'));

        return $this->products[$source][$index] ?? null;
    }

    public function media(string $asset): string
    {
        if (isset($this->media[$asset])) {
            return $this->media[$asset];
        }
        $path = $this->library->assetPath($asset);
        if ($path === null) {
            throw new BusinessRuleViolation('TEMPLATE_ASSET_MISSING', 'A photo of this template is missing.', ['asset' => $asset]);
        }

        ['id' => $id, 'created' => $created] = $this->mediaLibrary->import($path, str_replace('/', '-', $asset), $this->library->assetAlt($asset));
        if ($created) {
            $this->importedMedia++;
        }

        return $this->media[$asset] = $id;
    }

    public function banner(array $attributes): string
    {
        $validator = Validator::make($attributes, array_diff_key(PortableTemplate::bannerRules(), array_flip(['image', 'image.asset', 'mobile_image', 'mobile_image.asset'])));
        if ($validator->fails()) {
            throw new BusinessRuleViolation('TEMPLATE_INVALID', 'A banner of this template is invalid.', ['errors' => $validator->errors()->toArray()]);
        }

        $existing = Banner::query()
            ->where('placement', $attributes['placement'])
            ->where('name', $attributes['name'])
            ->where('title', $attributes['title'] ?? null)
            ->where('link_url', $attributes['link_url'] ?? null)
            ->where('desktop_media_id', $attributes['desktop_media_id'])
            ->value('id');
        if (is_string($existing)) {
            $this->reusedBanners++;

            return $existing;
        }

        $banner = $this->banners->save(new Banner, $attributes + ['is_active' => true, 'starts_at' => null, 'ends_at' => null]);
        $this->createdBanners++;

        return $banner->id;
    }

    public function menu(string $ref): ?string
    {
        if (array_key_exists($ref, $this->menus)) {
            return $this->menus[$ref];
        }
        $locations = match ($ref) {
            'main' => [MenuLocation::Main],
            'footer' => [MenuLocation::Footer1, MenuLocation::Footer2, MenuLocation::Footer3],
            default => array_filter([MenuLocation::tryFrom($ref)]),
        };
        $id = null;
        foreach ($locations as $location) {
            $id = Menu::query()->where('location', $location)->where('is_active', true)->orderBy('created_at')->value('id');
            if (is_string($id)) {
                break;
            }
        }

        return $this->menus[$ref] = $id;
    }

    /**
     * What this apply added: `{media, banners}` created, `banners_reused`.
     *
     * @return array{media: int, banners: int, banners_reused: int}
     */
    public function summary(): array
    {
        return ['media' => $this->importedMedia, 'banners' => $this->createdBanners, 'banners_reused' => $this->reusedBanners];
    }
}
