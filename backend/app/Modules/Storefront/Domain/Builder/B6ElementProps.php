<?php

namespace App\Modules\Storefront\Domain\Builder;

use Closure;

/**
 * Props of the B6 elements (content blocks, media, shop-focused elements, the scrolling text
 * and the chart) for BuilderDocumentSchema: every key present afterwards (missing keys take
 * the registry defaults), unknown keys dropped, each value checked against its limit. Problems
 * are reported through `$error(<prop path>, message)` (e.g. `items.2.title`), the value then
 * falls back to its default.
 *
 * Repeatable lists (`items`, `images`, `logos`, `series`, `hotspots`) hold objects with an `id`
 * (BuilderDocumentSchema::ID_PATTERN, unique within the list) that translations refer to:
 * `<list>.<item id>.<field>`. Ownership of referenced ids (media, categories, products) is
 * checked by Application\Builder\BuilderReferences; rich text is sanitized on save.
 *
 * B8a: the chart takes the stacked kinds (2–6 series of values ≥ 0) and a `data_source`
 * (`manual`, or a store source rendered from `data[id]`) with `source_product_id`.
 */
final class B6ElementProps extends ElementProps
{
    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $limit = fn (string $key) => ElementRegistry::LIST_LIMITS["{$type}.{$key}"];
        $max = fn (string $key) => ElementRegistry::B6_TEXT_LIMITS["{$type}.{$key}"] ?? ElementRegistry::TRANSLATABLE[$type][$key];

        return match ($type) {
            'accordion' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'title' => $this->text($item['title'] ?? null, "{$path}.title", 1, $max('items.title')),
                    'html' => $this->text($item['html'] ?? null, "{$path}.html", 0, $max('items.html')),
                ]),
                'open_first' => $this->bool('open_first'),
                'allow_multiple' => $this->bool('allow_multiple'),
                'style' => $this->enum('style', ElementRegistry::ACCORDION_STYLES),
            ],
            'tabs' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'title' => $this->text($item['title'] ?? null, "{$path}.title", 1, $max('items.title')),
                    'html' => $this->text($item['html'] ?? null, "{$path}.html", 0, $max('items.html')),
                ]),
                'layout' => $this->enum('layout', ElementRegistry::TABS_LAYOUTS),
            ],
            'icon_box' => [
                'icon' => $this->enum('icon', ElementRegistry::ICONS),
                'title' => $this->text($this->raw('title'), 'title', 1, $max('title')),
                'text' => $this->text($this->raw('text'), 'text', 0, $max('text')),
                'link' => $this->link($this->raw('link'), 'link'),
                'layout' => $this->enum('layout', ElementRegistry::ICON_BOX_LAYOUTS),
                'icon_style' => $this->enum('icon_style', ElementRegistry::ICON_STYLES),
            ],
            'icon_list' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'icon' => $this->icon($item['icon'] ?? null, "{$path}.icon", false),
                    'text' => $this->text($item['text'] ?? null, "{$path}.text", 1, $max('items.text')),
                    'link' => $this->link($item['link'] ?? null, "{$path}.link"),
                ]),
                'layout' => $this->enum('layout', ElementRegistry::ICON_LIST_LAYOUTS),
            ],
            'quote' => [
                'text' => $this->text($this->raw('text'), 'text', 1, $max('text')),
                'author' => $this->text($this->raw('author'), 'author', 0, $max('author')),
                'role' => $this->text($this->raw('role'), 'role', 0, $max('role')),
                'style' => $this->enum('style', ElementRegistry::QUOTE_STYLES),
            ],
            'notice' => $this->notice($max),
            'counter' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'value' => $this->decimal($item['value'] ?? null, "{$path}.value", ElementRegistry::COUNTER_VALUE, 2),
                    'prefix' => $this->text($item['prefix'] ?? null, "{$path}.prefix", 0, $max('items.prefix')),
                    'suffix' => $this->text($item['suffix'] ?? null, "{$path}.suffix", 0, $max('items.suffix')),
                    'label' => $this->text($item['label'] ?? null, "{$path}.label", 1, $max('items.label')),
                ]),
                'animate' => $this->bool('animate'),
            ],
            'steps' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'title' => $this->text($item['title'] ?? null, "{$path}.title", 1, $max('items.title')),
                    'text' => $this->text($item['text'] ?? null, "{$path}.text", 0, $max('items.text')),
                    'icon' => $this->icon($item['icon'] ?? null, "{$path}.icon", true),
                ]),
                'layout' => $this->enum('layout', ElementRegistry::STEPS_LAYOUTS),
                'numbered' => $this->bool('numbered'),
            ],
            'chart' => $this->chart($max),
            'gallery' => [
                'images' => $this->list('images', $limit('images'), fn (array $item, string $path) => [
                    'media_id' => $this->uuid($item['media_id'] ?? null, "{$path}.media_id", 'Choose an image from the media library.'),
                    'alt' => $this->text($item['alt'] ?? null, "{$path}.alt", 0, $max('images.alt')),
                    'caption' => $this->text($item['caption'] ?? null, "{$path}.caption", 0, $max('images.caption')),
                ]),
                'columns' => $this->columns(ElementRegistry::GALLERY_COLUMNS),
                'aspect' => $this->enum('aspect', ElementRegistry::GALLERY_ASPECTS),
                'lightbox' => $this->bool('lightbox'),
                'gap' => $this->enum('gap', ElementRegistry::GALLERY_GAPS),
            ],
            'image_carousel' => [
                'images' => $this->list('images', $limit('images'), fn (array $item, string $path) => [
                    'media_id' => $this->uuid($item['media_id'] ?? null, "{$path}.media_id", 'Choose an image from the media library.'),
                    'alt' => $this->text($item['alt'] ?? null, "{$path}.alt", 0, $max('images.alt')),
                    'caption' => $this->text($item['caption'] ?? null, "{$path}.caption", 0, $max('images.caption')),
                    'link' => $this->link($item['link'] ?? null, "{$path}.link"),
                ]),
                'autoplay' => $this->int('autoplay', ElementRegistry::CAROUSEL_AUTOPLAY),
                'show_dots' => $this->bool('show_dots'),
                'show_arrows' => $this->bool('show_arrows'),
                'aspect' => $this->enum('aspect', ElementRegistry::GALLERY_ASPECTS),
            ],
            'logo_carousel' => [
                'logos' => $this->list('logos', $limit('logos'), fn (array $item, string $path) => [
                    'media_id' => $this->uuid($item['media_id'] ?? null, "{$path}.media_id", 'Choose a logo from the media library.'),
                    'alt' => $this->text($item['alt'] ?? null, "{$path}.alt", 0, $max('logos.alt')),
                    'link' => $this->link($item['link'] ?? null, "{$path}.link"),
                ]),
                'grayscale' => $this->bool('grayscale'),
                'speed' => $this->enum('speed', ElementRegistry::SPEEDS),
            ],
            'map' => [
                'query' => $this->text($this->raw('query'), 'query', 1, $max('query'), 'Enter the store address, or its position as "latitude,longitude".'),
                'title' => $this->text($this->raw('title'), 'title', 1, $max('title')),
                'height' => $this->int('height', ElementRegistry::MAP_HEIGHT),
                'zoom' => $this->int('zoom', ElementRegistry::MAP_ZOOM),
            ],
            'category_card' => [
                'category_id' => $this->uuid($this->raw('category_id'), 'category_id', 'Choose a category.'),
                'media_id' => $this->raw('media_id') === null ? null : $this->uuid($this->raw('media_id'), 'media_id', 'Choose an image from the media library.'),
                'title' => $this->nullableText($this->raw('title'), 'title', $max('title')),
                'button_label' => $this->text($this->raw('button_label'), 'button_label', 0, $max('button_label')),
                'layout' => $this->enum('layout', ElementRegistry::CATEGORY_CARD_LAYOUTS),
            ],
            'product_spotlight' => [
                'product_id' => $this->uuid($this->raw('product_id'), 'product_id', 'Choose a product.'),
                'layout' => $this->enum('layout', ElementRegistry::SPOTLIGHT_LAYOUTS),
                'show_description' => $this->bool('show_description'),
                'badge' => $this->text($this->raw('badge'), 'badge', 0, $max('badge')),
            ],
            'shop_the_look' => $this->shopTheLook($max, $limit('hotspots')),
            'trust_badges' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'icon' => $this->icon($item['icon'] ?? null, "{$path}.icon", false),
                    'title' => $this->text($item['title'] ?? null, "{$path}.title", 1, $max('items.title')),
                    'text' => $this->text($item['text'] ?? null, "{$path}.text", 0, $max('items.text')),
                ]),
                'style' => $this->enum('style', ElementRegistry::TRUST_BADGE_STYLES),
            ],
            'recently_viewed' => [
                'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
                'limit' => $this->int('limit', ElementRegistry::RECENTLY_VIEWED_LIMIT),
            ],
            'marquee' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'text' => $this->text($item['text'] ?? null, "{$path}.text", 1, $max('items.text')),
                ]),
                'speed' => $this->enum('speed', ElementRegistry::SPEEDS),
                'direction' => $this->enum('direction', ElementRegistry::MARQUEE_DIRECTIONS),
                'separator' => $this->enum('separator', ElementRegistry::MARQUEE_SEPARATORS),
            ],
        };
    }

    /**
     * A notice needs a title or a text; its tone is shown with an icon and a label, never by
     * colour alone (storefront).
     *
     * @param  Closure(string): int  $max
     * @return array<string, mixed>
     */
    private function notice(Closure $max): array
    {
        $title = $this->text($this->raw('title'), 'title', 0, $max('title'));
        $text = $this->text($this->raw('text'), 'text', 0, $max('text'));
        if (trim($title) === '' && trim($text) === '') {
            ($this->error)('title', 'Enter a title or a text.');
        }

        return [
            'tone' => $this->enum('tone', ElementRegistry::NOTICE_TONES),
            'title' => $title,
            'text' => $text,
            'show_icon' => $this->bool('show_icon'),
        ];
    }

    /**
     * The chart (contract §3): category labels × 1–6 series of numbers (one value per label);
     * pie and donut charts take exactly one series of at most 8 non-negative values, not all zero.
     *
     * @param  Closure(string): int  $max
     * @return array<string, mixed>
     */
    private function chart(Closure $max): array
    {
        $kind = $this->enum('kind', ElementRegistry::CHART_KINDS);
        [$minLabels, $maxLabels] = ElementRegistry::LIST_LIMITS['chart.labels'];
        $labels = [];
        $raw = $this->raw('labels');
        if (! is_array($raw) || ! array_is_list($raw)) {
            ($this->error)('labels', 'The labels must be a list of names.');
        } else {
            if (count($raw) < $minLabels || count($raw) > $maxLabels) {
                ($this->error)('labels', "Enter {$minLabels} to {$maxLabels} labels.");
            }
            foreach ($raw as $i => $label) {
                $labels[] = $this->text($label, "labels.{$i}", 1, $max('labels'), null, '');
            }
        }

        $pie = in_array($kind, ['pie', 'donut'], true);
        // B8a: stacked columns / bars add up 2–6 series of non-negative values.
        $stacked = in_array($kind, ElementRegistry::CHART_STACKED_KINDS, true);
        if ($pie && count($labels) > ElementRegistry::CHART_PIE_LABELS) {
            ($this->error)('labels', 'A pie or donut chart shows at most '.ElementRegistry::CHART_PIE_LABELS.' slices.');
        }
        $series = $this->list('series', ElementRegistry::LIST_LIMITS['chart.series'], fn (array $item, string $path) => [
            'name' => $this->text($item['name'] ?? null, "{$path}.name", 1, $max('series.name')),
            'values' => $this->values($item['values'] ?? null, "{$path}.values", count($labels), $pie, $stacked),
        ]);
        if ($pie && count($series) > 1) {
            ($this->error)('series', 'A pie or donut chart shows exactly one series.');
        }
        if ($stacked && count($series) < ElementRegistry::CHART_STACKED_SERIES[0]) {
            ($this->error)('series', 'A stacked chart needs '.ElementRegistry::CHART_STACKED_SERIES[0].' to '.ElementRegistry::CHART_STACKED_SERIES[1].' series.');
        }

        // B8a: where the numbers come from — typed in, or counts from the store.
        $source = $this->enum('data_source', ElementRegistry::CHART_DATA_SOURCES);
        if ($source !== 'manual' && $stacked) {
            ($this->error)('data_source', 'A stacked chart needs your own numbers (2 to 6 series); store data has one series.');
        }
        $sourceProductId = $source === 'store.rating_breakdown'
            ? $this->nullableUuid($this->raw('source_product_id'), 'source_product_id', 'Choose a product, or none for all products.')
            : null;

        return [
            'kind' => $kind,
            'title' => $this->text($this->raw('title'), 'title', 1, $max('title')),
            'description' => $this->text($this->raw('description'), 'description', 0, $max('description')),
            'labels' => $labels,
            'series' => $series,
            'unit' => $this->text($this->raw('unit'), 'unit', 0, $max('unit')),
            'unit_position' => $this->enum('unit_position', ElementRegistry::CHART_UNIT_POSITIONS),
            'y_starts_at_zero' => $this->bool('y_starts_at_zero'),
            'show_values' => $this->enum('show_values', ElementRegistry::CHART_SHOW_VALUES),
            'show_legend' => $this->bool('show_legend'),
            'show_table' => $this->bool('show_table'),
            'height' => $this->int('height', ElementRegistry::CHART_HEIGHT),
            'data_source' => $source,
            'source_product_id' => $sourceProductId,
        ];
    }

    /**
     * One number per label (|value| ≤ 10^12); pie / donut values are ≥ 0 and not all zero;
     * stacked values are ≥ 0.
     *
     * @return list<int|float>
     */
    private function values(mixed $values, string $path, int $count, bool $pie, bool $stacked = false): array
    {
        if (! is_array($values) || ! array_is_list($values)) {
            ($this->error)($path, 'The values must be a list of numbers.');

            return [];
        }
        if (count($values) !== $count) {
            ($this->error)($path, "Enter one value per label ({$count}).");
        }
        $result = [];
        foreach ($values as $i => $value) {
            if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value) || abs((float) $value) > ElementRegistry::CHART_VALUE_MAX) {
                ($this->error)("{$path}.{$i}", 'Enter a number (at most 1 000 000 000 000 either way).');
                $result[] = 0;

                continue;
            }
            if ($pie && $value < 0) {
                ($this->error)("{$path}.{$i}", 'A pie or donut chart cannot show negative values.');
            }
            if ($stacked && $value < 0) {
                ($this->error)("{$path}.{$i}", 'A stacked chart cannot show negative values.');
            }
            $result[] = $value;
        }
        if ($pie && $result !== [] && array_sum(array_map(fn ($v) => max(0, $v), $result)) <= 0) {
            ($this->error)($path, 'A pie or donut chart needs at least one value above zero.');
        }

        return $result;
    }

    /**
     * Shop the look: a photo with 1–8 hotspots, each placing a product at x / y percent.
     *
     * @param  Closure(string): int  $max
     * @param  array{0: int, 1: int}  $limit
     * @return array<string, mixed>
     */
    private function shopTheLook(Closure $max, array $limit): array
    {
        $products = [];
        $hotspots = $this->list('hotspots', $limit, function (array $item, string $path) use (&$products) {
            $productId = $this->uuid($item['product_id'] ?? null, "{$path}.product_id", 'Choose a product for this spot.');
            if ($productId !== null && isset($products[$productId])) {
                ($this->error)("{$path}.product_id", 'This product already has a spot on the photo.');
            }
            if ($productId !== null) {
                $products[$productId] = true;
            }

            return [
                'x' => $this->decimal($item['x'] ?? null, "{$path}.x", [0, 100], 2),
                'y' => $this->decimal($item['y'] ?? null, "{$path}.y", [0, 100], 2),
                'product_id' => $productId,
            ];
        });

        return [
            'media_id' => $this->uuid($this->raw('media_id'), 'media_id', 'Choose a photo from the media library.'),
            'alt' => $this->text($this->raw('alt'), 'alt', 0, $max('alt')),
            'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
            'hotspots' => $hotspots,
        ];
    }
}
