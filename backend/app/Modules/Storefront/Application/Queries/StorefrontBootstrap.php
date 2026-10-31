<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Storefront\Domain\MenuItemType;
use App\Modules\Storefront\Domain\MenuLocation;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * Everything the storefront needs before it can draw a page: store identity, theme
 * (media ids resolved to URLs), the announcement if it is live now, and the active
 * menus with their visible items as trees.
 */
class StorefrontBootstrap
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly MediaLibrary $media,
        private readonly PageDirectory $pages,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function build(): array
    {
        $settings = $this->config->settings();
        $theme = $this->config->theme();
        $t = $theme->settings;

        $menus = Menu::query()->where('is_active', true)->with(['items' => fn ($q) => $q->where('is_visible', true)])->get();

        $mediaIds = ThemeSchema::mediaIds($t);
        foreach ($menus as $menu) {
            array_push($mediaIds, ...$menu->items->pluck('image_media_id')->filter()->all());
        }
        $refs = $this->media->refs(array_values(array_unique($mediaIds)));
        $ref = fn (?string $id) => $id !== null ? ($refs[$id] ?? null) : null;

        $pageIds = $menus->flatMap(fn (Menu $menu) => $menu->items->where('type', MenuItemType::Page)->pluck('target_id'))->filter()->unique()->values()->all();
        $pages = $this->pages->visible($pageIds);

        return [
            'store' => [
                'name' => $settings->site_name,
                'description' => $settings->meta_description,
            ],
            'theme' => [
                'colors' => $t['colors'],
                'typography' => $t['typography'],
                'shape' => $t['shape'],
                'layout' => $t['layout'],
                'logo' => $ref($t['logo_media_id']),
                'favicon' => $ref($t['favicon_media_id']),
                'announcement' => $this->liveAnnouncement($t['announcement']),
                'footer' => [
                    'about' => $t['footer']['about'],
                    'copyright' => $t['footer']['copyright'],
                    'contact' => $t['footer']['contact'],
                    'social' => array_filter($t['footer']['social']),
                    'payment_logos' => array_values(array_filter(array_map($ref, $t['footer']['payment_logo_media_ids']))),
                ],
                'custom_css' => $theme->custom_css,
            ],
            'menus' => $menus
                ->mapWithKeys(fn (Menu $menu) => [$menu->location->value => [
                    'name' => $menu->name,
                    'items' => $this->tree($menu->items, null, $ref, $pages),
                ]])
                ->sortKeysUsing(fn (string $a, string $b) => array_search(MenuLocation::from($a), MenuLocation::cases(), true) <=> array_search(MenuLocation::from($b), MenuLocation::cases(), true))
                ->all(),
        ];
    }

    /**
     * @param  array<string, mixed>  $announcement
     * @return array{text: string, link: ?string, background: string, foreground: string}|null
     */
    private function liveAnnouncement(array $announcement): ?array
    {
        if (! $announcement['enabled'] || ! is_string($announcement['text']) || $announcement['text'] === '') {
            return null;
        }

        $now = CarbonImmutable::now();
        if (($announcement['starts_at'] && $now->lt(CarbonImmutable::parse($announcement['starts_at'])))
            || ($announcement['ends_at'] && $now->gte(CarbonImmutable::parse($announcement['ends_at'])))) {
            return null;
        }

        return [
            'text' => $announcement['text'],
            'link' => $announcement['link'],
            'background' => $announcement['background'],
            'foreground' => $announcement['foreground'],
        ];
    }

    /**
     * Visible items only; a hidden parent hides its whole branch. Items linking to a page
     * that is not published (any more) are left out like hidden ones.
     *
     * @param  Collection<int, MenuItem>  $items
     * @param  array<string, array{id: string, slug: string, title: string}>  $pages
     * @return list<array<string, mixed>>
     */
    private function tree(Collection $items, ?string $parentId, callable $ref, array $pages): array
    {
        return $items
            ->where('parent_id', $parentId)
            ->sortBy('sort_order')
            ->filter(fn (MenuItem $item) => $item->type !== MenuItemType::Page || isset($pages[$item->target_id]))
            ->map(fn (MenuItem $item) => [
                'id' => $item->id,
                'label' => $item->label,
                'url' => $item->type === MenuItemType::Page ? '/pages/'.$pages[$item->target_id]['slug'] : $item->url,
                'open_in_new_tab' => $item->open_in_new_tab,
                'is_mega' => $item->is_mega,
                'mega_columns' => $item->mega_columns,
                'image' => $ref($item->image_media_id),
                'children' => $this->tree($items, $item->id, $ref, $pages),
            ])
            ->values()
            ->all();
    }
}
