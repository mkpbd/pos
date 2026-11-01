<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;

/**
 * Admin-facing output shapes of banners and homepage sections.
 */
final class ContentPresenter
{
    /**
     * @return array<string, mixed>
     */
    public static function banner(Banner $b): array
    {
        return [
            'id' => $b->id,
            'placement' => $b->placement->value,
            'name' => $b->name,
            'kicker' => $b->kicker,
            'title' => $b->title,
            'subtitle' => $b->subtitle,
            'link_url' => $b->link_url,
            'button_label' => $b->button_label,
            'secondary_link_url' => $b->secondary_link_url,
            'secondary_button_label' => $b->secondary_button_label,
            'desktop_media_id' => $b->desktop_media_id,
            'mobile_media_id' => $b->mobile_media_id,
            'text_color' => $b->text_color,
            'text_position' => $b->text_position,
            'popup_delay_seconds' => $b->popup_delay_seconds,
            'popup_frequency' => $b->popup_frequency,
            'starts_at' => $b->starts_at?->toIso8601String(),
            'ends_at' => $b->ends_at?->toIso8601String(),
            'is_active' => $b->is_active,
            'is_live' => $b->isLive(),
            'state' => $b->state(),
            'sort_order' => $b->sort_order,
            'updated_at' => $b->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function section(HomepageSection $s): array
    {
        $manual = $s->type->manualItemLimits();
        $itemIds = $manual === null ? [] : $s->items
            ->where('item_type', $manual['type'])->sortBy('sort_order')->pluck('item_id')->values()->all();
        $summaries = $itemIds === [] ? [] : app(StorefrontCatalog::class)->itemSummaries($manual['type'], $itemIds);

        return [
            'id' => $s->id,
            'type' => $s->type->value,
            'type_label' => $s->type->label(),
            'title' => $s->title,
            'subtitle' => $s->subtitle,
            'config' => $s->type->normalize($s->config),
            'banner_ids' => $s->type->bannerPlacement() === null ? [] : $s->items
                ->where('item_type', HomepageSectionItem::TYPE_BANNER)->sortBy('sort_order')->pluck('item_id')->values()->all(),
            // Hand-picked products, categories or brands, in order, with names for the editor.
            'item_ids' => $itemIds,
            'items' => array_values(array_filter(array_map(fn (string $id) => $summaries[$id] ?? null, $itemIds))),
            'is_enabled' => $s->is_enabled,
            'starts_at' => $s->starts_at?->toIso8601String(),
            'ends_at' => $s->ends_at?->toIso8601String(),
            'state' => $s->scheduleState(),
            'sort_order' => $s->sort_order,
            'updated_at' => $s->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The section types the builder offers, with their limits and defaults.
     *
     * @return list<array<string, mixed>>
     */
    public static function types(): array
    {
        return array_map(fn (SectionType $t) => [
            'type' => $t->value,
            'label' => $t->label(),
            'description' => $t->description(),
            'banner_placement' => $t->bannerPlacement()?->value,
            'items' => $t->itemLimits(),
            'manual_items' => $t->manualItemLimits(),
            'defaults' => $t->defaults(),
        ], SectionType::cases());
    }
}
