<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\MenuItemType;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;
use Illuminate\Support\Facades\DB;

/**
 * Saves a menu's whole item tree in one go (the admin editor always sends the full,
 * ordered tree). Mega menus are a main-navigation, top-level feature.
 */
class ReplaceMenuItems
{
    public const MAX_ITEMS = 200;

    public function __construct(
        private readonly MediaLibrary $media,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  list<array<string, mixed>>  $items  validated tree (children under "children")
     */
    public function __invoke(Menu $menu, array $items): Menu
    {
        $flat = $this->flatten($items);
        if (count($flat) > self::MAX_ITEMS) {
            throw new BusinessRuleViolation('MENU_TOO_LARGE', 'A menu can have at most '.self::MAX_ITEMS.' items.');
        }

        foreach ($flat as [$item, $depth]) {
            if (($item['is_mega'] ?? false) && ($depth > 0 || ! $menu->location->allowsMega())) {
                throw new BusinessRuleViolation('MEGA_MENU_NOT_ALLOWED', 'Only top-level items of the main navigation can open a mega menu.');
            }
        }

        $imageIds = array_values(array_filter(array_map(fn (array $pair) => $pair[0]['image_media_id'] ?? null, $flat)));
        $missing = array_values(array_diff($imageIds, $this->media->existing($imageIds)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'Some selected images no longer exist in the media library.', ['media_ids' => $missing]);
        }

        return DB::transaction(function () use ($menu, $items, $flat) {
            Menu::query()->whereKey($menu->id)->lockForUpdate()->first();
            $previous = $menu->items()->count();

            $menu->items()->whereNull('parent_id')->delete();
            $this->insert($menu, $items, null);

            $this->audit->record('menu.items_replaced', $menu, ['items' => $previous], ['items' => count($flat)]);

            return $menu->load('items');
        });
    }

    /**
     * @param  list<array<string, mixed>>  $items
     */
    private function insert(Menu $menu, array $items, ?string $parentId): void
    {
        foreach (array_values($items) as $position => $item) {
            $isMega = (bool) ($item['is_mega'] ?? false);
            $created = MenuItem::query()->create([
                'menu_id' => $menu->id,
                'parent_id' => $parentId,
                'type' => MenuItemType::from($item['type'] ?? MenuItemType::Custom->value),
                'label' => trim((string) $item['label']),
                'url' => $item['url'],
                'open_in_new_tab' => (bool) ($item['open_in_new_tab'] ?? false),
                'is_visible' => (bool) ($item['is_visible'] ?? true),
                'is_mega' => $isMega,
                'mega_columns' => $isMega ? (int) ($item['mega_columns'] ?? 4) : null,
                'image_media_id' => $isMega ? ($item['image_media_id'] ?? null) : null,
                'sort_order' => $position,
            ]);

            $this->insert($menu, $item['children'] ?? [], $created->id);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $items
     * @return list<array{array<string, mixed>, int}> item and its depth (0 = top level)
     */
    private function flatten(array $items, int $depth = 0): array
    {
        $flat = [];
        foreach ($items as $item) {
            $flat[] = [$item, $depth];
            array_push($flat, ...$this->flatten($item['children'] ?? [], $depth + 1));
        }

        return $flat;
    }
}
