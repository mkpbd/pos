<?php

namespace App\Modules\Storefront\Application\Builder\Templates;

use App\Modules\Media\Application\Contracts\MediaLibrary;
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
 *   footer column that has one), or null.
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

    public function __construct(
        private readonly BuilderTemplateLibrary $library,
        private readonly MediaLibrary $mediaLibrary,
        private readonly ManageBanners $banners,
    ) {}

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
