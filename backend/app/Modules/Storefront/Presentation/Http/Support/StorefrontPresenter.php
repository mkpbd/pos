<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\MenuItem;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;
use Illuminate\Support\Collection;

/**
 * Admin-facing output shapes of the storefront configuration.
 */
final class StorefrontPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function settings(StorefrontSettings $s): array
    {
        return [
            'is_enabled' => $s->is_enabled,
            'site_name' => $s->site_name,
            'meta_description' => $s->meta_description,
            'fulfilment_store_id' => $s->fulfilment_store_id,
            'guest_checkout_enabled' => $s->guest_checkout_enabled,
            'return_window_days' => $s->return_window_days,
            'allow_indexing' => $s->allow_indexing,
            'bangla_enabled' => $s->bangla_enabled,
            'default_locale' => $s->default_locale,
            'bangla_digits' => $s->bangla_digits,
            'updated_at' => $s->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function domain(StorefrontDomain $d): array
    {
        return [
            'id' => $d->id,
            'host' => $d->host,
            'is_primary' => $d->is_primary,
            'created_at' => $d->created_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function theme(ThemeSettings $t, bool $withCss): array
    {
        return [
            'settings' => $t->settings,
            'custom_css' => $withCss ? $t->custom_css : null,
            'has_custom_css' => $t->custom_css !== null,
            'updated_at' => $t->updated_at?->toIso8601String(),
        ];
    }

    /**
     * T1: the presets with the complete theme each produces on a blank theme.
     *
     * @return list<array{key: string, name: string, description: string, theme: array<string, mixed>}>
     */
    public static function themePresets(): array
    {
        return array_map(fn (string $key) => [
            'key' => $key,
            'name' => ThemePresets::name($key),
            'description' => ThemePresets::description($key),
            'theme' => ThemePresets::theme($key),
        ], ThemePresets::KEYS);
    }

    /**
     * @return array<string, mixed>
     */
    public static function menu(Menu $m, bool $withItems): array
    {
        $data = [
            'id' => $m->id,
            'name' => $m->name,
            'location' => $m->location->value,
            'location_label' => $m->location->label(),
            'is_active' => $m->is_active,
            'updated_at' => $m->updated_at?->toIso8601String(),
        ];

        if ($withItems) {
            $data['items'] = self::items($m->items, null);
        }

        return $data;
    }

    /**
     * @param  Collection<int, MenuItem>  $items
     * @return list<array<string, mixed>>
     */
    private static function items(Collection $items, ?string $parentId): array
    {
        return $items->where('parent_id', $parentId)->sortBy('sort_order')->map(fn (MenuItem $i) => [
            'id' => $i->id,
            'type' => $i->type->value,
            'label' => $i->label,
            'url' => $i->url,
            'target_id' => $i->target_id,
            'open_in_new_tab' => $i->open_in_new_tab,
            'is_visible' => $i->is_visible,
            'is_mega' => $i->is_mega,
            'mega_columns' => $i->mega_columns,
            'image_media_id' => $i->image_media_id,
            // E12b: {bn: {label}}.
            'translations' => TranslationInput::present($i->translations),
            'children' => self::items($items, $i->id),
        ])->values()->all();
    }
}
