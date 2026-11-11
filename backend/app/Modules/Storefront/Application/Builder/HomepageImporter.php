<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Domain\Translations;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;
use Illuminate\Support\Str;

/**
 * "Convert my current homepage" (B1): every homepage section, in order, becomes a builder
 * section (full-bleed — the section components draw their own container) with one 100 % column holding the
 * matching wrapped element — same title, subtitle, config, items and translations. A
 * disabled section becomes a hidden section, its schedule the section's schedule. The
 * result is a raw document; the caller prepares (validates) it like any other content.
 */
class HomepageImporter
{
    /**
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     */
    public function document(): array
    {
        $document = BuilderDocumentSchema::blank();

        foreach (HomepageSection::query()->with('items')->orderBy('sort_order')->get() as $section) {
            $type = $section->type;
            $config = $type->normalize($section->config);
            $schedule = $section->starts_at === null && $section->ends_at === null ? null : [
                'starts_at' => $section->starts_at?->toIso8601String(),
                'ends_at' => $section->ends_at?->toIso8601String(),
            ];

            $items = [];
            $itemType = $type->bannerPlacement() !== null ? HomepageSectionItem::TYPE_BANNER : ($type->usesManualItems($config) ? $type->manualItemLimits()['type'] : null);
            if ($itemType !== null) {
                foreach ($section->items as $item) {
                    if ($item->item_type === $itemType) {
                        $items[] = ['item_type' => $itemType, 'item_id' => $item->item_id];
                    }
                }
            }

            $document['sections'][] = [
                'id' => $this->id('s'),
                'type' => 'section',
                // The section components draw their own container and padding: full-bleed keeps
                // the converted page exactly as the homepage looks today.
                'props' => ['layout' => 'full-bleed', 'anchor' => null],
                'style' => [],
                'visibility' => ['desktop' => true, 'tablet' => true, 'mobile' => true],
                'hidden' => ! $section->is_enabled,
                'schedule' => $schedule,
                'translations' => [],
                'columns' => [[
                    'id' => $this->id('c'),
                    'type' => 'column',
                    'width' => ['base' => 100],
                    'style' => [],
                    'elements' => [[
                        'id' => $this->id('e'),
                        'type' => $type->value,
                        'props' => [
                            'title' => $section->title,
                            'subtitle' => $section->subtitle,
                            'config' => $config,
                            'items' => $items,
                        ],
                        'style' => [],
                        'visibility' => ['desktop' => true, 'tablet' => true, 'mobile' => true],
                        'hidden' => false,
                        'schedule' => null,
                        'translations' => Translations::decode($section->translations),
                    ]],
                ]],
            ];
        }

        return $document;
    }

    private function id(string $prefix): string
    {
        return $prefix.'_'.Str::lower(Str::random(10));
    }
}
