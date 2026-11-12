<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * B6: the new elements (content blocks, media, shop-focused, scrolling text, chart), their
 * limits and list translations (`<list>.<item id>.<field>`), the style `motion` group and
 * section background videos, sticky sections and shape dividers, and the cross-side fixture
 * sample-b6-elements.v1.json, which the storefront validates with the same expectations.
 */
class BuilderB6SchemaTest extends TestCase
{
    private const FIXTURE = '../frontend/src/storefront/builder/__fixtures__/sample-b6-elements.v1.json';

    private const MEDIA = '0199a5c1-0000-7000-8000-00000000aa01';

    private const MEDIA_2 = '0199a5c1-0000-7000-8000-00000000aa02';

    private const PRODUCT = '0199a5c1-0000-7000-8000-00000000bb01';

    private const PRODUCT_2 = '0199a5c1-0000-7000-8000-00000000bb02';

    private const CATEGORY = '0199a5c1-0000-7000-8000-00000000cc01';

    private function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $value = array_map(fn ($v) => $this->canonical($v), $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $element
     * @param  array<string, mixed>  $section  extra section keys
     * @return array<string, mixed>
     */
    private function doc(array $element, array $section = []): array
    {
        return ['schema_version' => 1, 'sections' => [$section + [
            'id' => 's_x', 'type' => 'section',
            'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => [['id' => 'e_x'] + $element]]],
        ]]];
    }

    /**
     * The normalized element, or the errors.
     *
     * @param  array<string, mixed>  $props
     * @param  array<string, mixed>  $extra
     * @return array{0: array<string, mixed>|null, 1: list<array<string, mixed>>}
     */
    private function element(string $type, array $props, string $context = 'page', array $extra = []): array
    {
        try {
            return [BuilderDocumentSchema::normalize($this->doc(['type' => $type, 'props' => $props] + $extra), $context)['sections'][0]['columns'][0]['elements'][0], []];
        } catch (InvalidBuilderDocument $e) {
            return [null, $e->errors];
        }
    }

    /**
     * @param  array<string, mixed>  $props
     * @return list<string> error paths relative to the props
     */
    private function errorPaths(string $type, array $props, string $context = 'page'): array
    {
        [, $errors] = $this->element($type, $props, $context);

        return array_map(fn (array $e) => (string) preg_replace('/^sections\.0\.columns\.0\.elements\.0\.props\.?/', '', $e['path']), $errors);
    }

    /**
     * Valid props of every element that needs content first.
     *
     * @return array<string, array<string, mixed>>
     */
    private static function minimal(): array
    {
        return [
            'chart' => [],
            'gallery' => ['images' => [['id' => 'g1', 'media_id' => self::MEDIA, 'alt' => 'Jam', 'caption' => '']]],
            'image_carousel' => ['images' => [['id' => 'k1', 'media_id' => self::MEDIA, 'alt' => '', 'caption' => '', 'link' => null]]],
            'logo_carousel' => ['logos' => [['id' => 'o1', 'media_id' => self::MEDIA, 'alt' => 'A', 'link' => null], ['id' => 'o2', 'media_id' => self::MEDIA_2, 'alt' => 'B', 'link' => null]]],
            'map' => ['query' => 'Dhanmondi, Dhaka'],
            'category_card' => ['category_id' => self::CATEGORY],
            'product_spotlight' => ['product_id' => self::PRODUCT],
            'shop_the_look' => ['media_id' => self::MEDIA, 'hotspots' => [['id' => 'h1', 'x' => 10, 'y' => 20, 'product_id' => self::PRODUCT]]],
        ];
    }

    public function test_the_fixture_round_trips_unchanged_and_holds_every_b6_feature(): void
    {
        $path = base_path(self::FIXTURE);
        $this->assertFileExists($path);
        $fixture = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

        $normalized = BuilderDocumentSchema::normalize($fixture, 'page');
        $this->assertSame($this->canonical($fixture), $this->canonical($normalized));
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized, 'page'));

        $types = [];
        BuilderDocumentSchema::walk($fixture, function (array $node, string $p, string $kind) use (&$types) {
            if ($kind === 'element') {
                $types[] = $node['type'];
            }
        });
        // One of every B6 element (+ an inner row and a second chart).
        $this->assertSame([], array_values(array_diff(ElementRegistry::B6, $types)));
        $json = (string) json_encode($fixture);
        foreach (['"sticky":true', '"shape_top":', '"shape_bottom":', '"motion":', '"video":{"url"', '"poster":'] as $needle) {
            $this->assertStringContainsString($needle, $json);
        }
        // Each B6 element carries a Bangla translation in the documented key format.
        $this->assertSame('ডেলিভারিতে কত দিন লাগে?', $fixture['sections'][0]['columns'][0]['elements'][0]['translations']['bn']['items.q1.title']);
    }

    public function test_the_registry_describes_the_b6_elements(): void
    {
        $meta = ElementRegistry::metadata();
        $byType = array_column($meta['types'], null, 'type');
        $this->assertSame(['layout', 'content', 'media', 'commerce', 'marketing', 'site'], $meta['enums']['groups']);

        $groups = [
            'content' => ['accordion', 'tabs', 'icon_box', 'icon_list', 'quote', 'notice', 'counter', 'steps', 'chart'],
            'media' => ['gallery', 'image_carousel', 'logo_carousel', 'map'],
            'commerce' => ['category_card', 'product_spotlight', 'shop_the_look', 'trust_badges', 'recently_viewed'],
            'marketing' => ['marquee'],
        ];
        foreach ($groups as $group => $types) {
            foreach ($types as $type) {
                $this->assertSame($group, $byType[$type]['group'], $type);
            }
        }
        $all = ['page', 'cms', 'header', 'footer', 'zone'];
        $withFooter = ['page', 'cms', 'zone', 'footer'];
        foreach (ElementRegistry::B6 as $type) {
            $expected = match ($type) {
                'icon_list', 'marquee' => [...$all, 'popup'],
                'accordion', 'icon_box', 'logo_carousel', 'map', 'trust_badges' => $withFooter,
                // B8b: notices go in popups too.
                'notice' => ['page', 'cms', 'zone', 'popup'],
                default => ['page', 'cms', 'zone'],
            };
            $this->assertEqualsCanonicalizing($expected, ElementRegistry::allowedIn($type), $type);
            $this->assertSame(in_array($type, ['category_card', 'product_spotlight', 'shop_the_look'], true), $byType[$type]['has_data'], $type);
        }

        $this->assertSame(['items.*.title', 'items.*.html'], $byType['accordion']['translatable']);
        $this->assertSame(['title', 'description', 'series.*.name', 'labels.*'], $byType['chart']['translatable']);
        $this->assertSame(['alt', 'title'], $byType['shop_the_look']['translatable']);
        $this->assertSame(['images.*.alt', 'images.*.caption'], $byType['gallery']['translatable']);
        $this->assertSame(['min' => 2, 'max' => 24], $meta['limits']['lists']['logo_carousel.logos']);
        $this->assertSame(StyleSchema::MOTION_ENTRANCES, $meta['enums']['motion_entrances']);
        $this->assertSame(['wave', 'curve', 'tilt', 'triangle', 'zigzag'], $meta['enums']['section_shapes']);

        // Defaults normalize unchanged; elements that need content are valid once given it.
        foreach (ElementRegistry::B6 as $type) {
            $props = self::minimal()[$type] ?? null;
            [$element, $errors] = $this->element($type, $props ?? ElementRegistry::defaults($type));
            $this->assertSame([], $errors, $type);
            $this->assertSame(array_keys(ElementRegistry::defaults($type)), array_keys($element['props']), $type);
            if ($props === null || $props === []) {
                $this->assertSame(ElementRegistry::defaults($type), $element['props'], $type);
            }
        }
        foreach (['gallery' => 'images', 'image_carousel' => 'images', 'logo_carousel' => 'logos', 'map' => 'query', 'category_card' => 'category_id', 'product_spotlight' => 'product_id', 'shop_the_look' => 'media_id'] as $type => $prop) {
            $this->assertContains($prop, $this->errorPaths($type, []), $type);
        }
    }

    /**
     * @return array<string, array{0: string, 1: array<string, mixed>, 2: list<string>}>
     */
    public static function invalidProps(): array
    {
        $items = fn (int $n, callable $make) => array_map($make, range(1, $n));
        $text = fn (int $length) => str_repeat('a', $length);

        return [
            'accordion empty' => ['accordion', ['items' => []], ['items']],
            'accordion 21 items' => ['accordion', ['items' => $items(21, fn ($i) => ['id' => "q{$i}", 'title' => 'Q', 'html' => ''])], ['items']],
            'accordion title too long, blank title, bad style' => ['accordion', ['items' => [['id' => 'q1', 'title' => $text(121), 'html' => ''], ['id' => 'q2', 'title' => ' ', 'html' => '']], 'style' => 'fancy'], ['items.0.title', 'items.1.title', 'style']],
            'accordion html too long' => ['accordion', ['items' => [['id' => 'q1', 'title' => 'Q', 'html' => $text(5001)]]], ['items.0.html']],
            'accordion item ids' => ['accordion', ['items' => [['id' => 'Q 1', 'title' => 'Q', 'html' => ''], ['id' => 'q2', 'title' => 'Q', 'html' => ''], ['id' => 'q2', 'title' => 'Q', 'html' => '']]], ['items.0.id', 'items.2.id']],
            'accordion not a list' => ['accordion', ['items' => ['a' => ['id' => 'q1', 'title' => 'Q', 'html' => '']], 'open_first' => 'yes'], ['items', 'open_first']],
            'tabs one item' => ['tabs', ['items' => [['id' => 't1', 'title' => 'A', 'html' => '']]], ['items']],
            'tabs 9 items' => ['tabs', ['items' => $items(9, fn ($i) => ['id' => "t{$i}", 'title' => 'T', 'html' => ''])], ['items']],
            'tabs title 61, html 8001, layout' => ['tabs', ['items' => [['id' => 't1', 'title' => $text(61), 'html' => ''], ['id' => 't2', 'title' => 'B', 'html' => $text(8001)]], 'layout' => 'diagonal'], ['items.0.title', 'items.1.html', 'layout']],
            'icon box' => ['icon_box', ['icon' => 'rocket', 'title' => '', 'text' => $text(401), 'link' => ['url' => 'javascript:alert(1)'], 'layout' => 'right', 'icon_style' => 'hexagon'], ['icon', 'title', 'text', 'link.url', 'layout', 'icon_style']],
            'icon list' => ['icon_list', ['items' => [['id' => 'l1', 'icon' => 'rocket', 'text' => $text(161), 'link' => ['url' => '//evil.test']]], 'layout' => 'grid'], ['items.0.icon', 'items.0.text', 'items.0.link.url', 'layout']],
            'icon list 21' => ['icon_list', ['items' => $items(21, fn ($i) => ['id' => "l{$i}", 'icon' => 'check', 'text' => 'x', 'link' => null])], ['items']],
            'quote' => ['quote', ['text' => '', 'author' => $text(81), 'role' => $text(81), 'style' => 'big'], ['text', 'author', 'role', 'style']],
            'notice without texts' => ['notice', ['tone' => 'danger', 'title' => '', 'text' => ''], ['title', 'tone']],
            'notice too long' => ['notice', ['title' => $text(121), 'text' => $text(401), 'show_icon' => 1], ['title', 'text', 'show_icon']],
            'counter values' => ['counter', ['items' => [
                ['id' => 'n1', 'value' => -1, 'prefix' => '', 'suffix' => '', 'label' => 'A'],
                ['id' => 'n2', 'value' => 1000000001, 'prefix' => '', 'suffix' => '', 'label' => 'B'],
                ['id' => 'n3', 'value' => 1.234, 'prefix' => '', 'suffix' => '', 'label' => 'C'],
                ['id' => 'n4', 'value' => '12', 'prefix' => '৳৳৳৳৳', 'suffix' => $text(9), 'label' => ''],
            ], 'animate' => 'no'], ['items.0.value', 'items.1.value', 'items.2.value', 'items.3.value', 'items.3.prefix', 'items.3.suffix', 'items.3.label', 'animate']],
            'counter 7' => ['counter', ['items' => $items(7, fn ($i) => ['id' => "n{$i}", 'value' => 1, 'prefix' => '', 'suffix' => '', 'label' => 'x'])], ['items']],
            'steps one' => ['steps', ['items' => [['id' => 'p1', 'title' => 'A', 'text' => '', 'icon' => null]]], ['items']],
            'steps fields' => ['steps', ['items' => [['id' => 'p1', 'title' => $text(81), 'text' => $text(301), 'icon' => 'rocket'], ['id' => 'p2', 'title' => 'B', 'text' => '', 'icon' => null]], 'numbered' => null], ['items.0.title', 'items.0.text', 'items.0.icon', 'numbered']],
            'gallery 31' => ['gallery', ['images' => $items(31, fn ($i) => ['id' => "g{$i}", 'media_id' => self::MEDIA, 'alt' => '', 'caption' => ''])], ['images']],
            'gallery fields' => ['gallery', ['images' => [['id' => 'g1', 'media_id' => 'nope', 'alt' => $text(201), 'caption' => $text(201)]], 'columns' => ['base' => 1, 'tablet' => 7, 'mobile' => 0], 'aspect' => '21:9', 'gap' => 'xl', 'lightbox' => 'yes'], ['images.0.media_id', 'images.0.alt', 'images.0.caption', 'columns.base', 'columns.tablet', 'columns.mobile', 'aspect', 'lightbox', 'gap']],
            'carousel' => ['image_carousel', ['images' => $items(21, fn ($i) => ['id' => "k{$i}", 'media_id' => self::MEDIA, 'alt' => '', 'caption' => '', 'link' => null]), 'autoplay' => 16, 'show_dots' => 'x', 'aspect' => 'tall'], ['images', 'autoplay', 'show_dots', 'aspect']],
            'carousel link' => ['image_carousel', ['images' => [['id' => 'k1', 'media_id' => self::MEDIA, 'alt' => '', 'caption' => '', 'link' => ['url' => 'ftp://x']]]], ['images.0.link.url']],
            'logos one' => ['logo_carousel', ['logos' => [['id' => 'o1', 'media_id' => self::MEDIA, 'alt' => '', 'link' => null]], 'speed' => 'warp'], ['logos', 'speed']],
            'logos 25' => ['logo_carousel', ['logos' => $items(25, fn ($i) => ['id' => "o{$i}", 'media_id' => self::MEDIA, 'alt' => '', 'link' => null])], ['logos']],
            'map' => ['map', ['query' => $text(201), 'title' => '', 'height' => 199, 'zoom' => 21], ['query', 'title', 'height', 'zoom']],
            'map bounds' => ['map', ['query' => 'x', 'height' => 601, 'zoom' => 2], ['height', 'zoom']],
            'category card' => ['category_card', ['category_id' => 'shoes', 'media_id' => 'nope', 'title' => $text(121), 'button_label' => $text(31), 'layout' => 'side'], ['category_id', 'media_id', 'title', 'button_label', 'layout']],
            'spotlight' => ['product_spotlight', ['product_id' => null, 'layout' => 'top', 'show_description' => 'yes', 'badge' => $text(25)], ['product_id', 'layout', 'show_description', 'badge']],
            'shop the look' => ['shop_the_look', ['media_id' => null, 'alt' => $text(201), 'title' => $text(121), 'hotspots' => [
                ['id' => 'h1', 'x' => 101, 'y' => -1, 'product_id' => self::PRODUCT],
                ['id' => 'h2', 'x' => 10.555, 'y' => 'top', 'product_id' => self::PRODUCT],
                ['id' => 'h3', 'x' => 1, 'y' => 1, 'product_id' => 'nope'],
            ]], ['media_id', 'alt', 'title', 'hotspots.0.x', 'hotspots.0.y', 'hotspots.1.x', 'hotspots.1.y', 'hotspots.1.product_id', 'hotspots.2.product_id']],
            'shop the look 9 spots' => ['shop_the_look', ['media_id' => self::MEDIA, 'hotspots' => $items(9, fn ($i) => ['id' => "h{$i}", 'x' => $i, 'y' => $i, 'product_id' => sprintf('0199a5c1-0000-7000-8000-%012d', $i)])], ['hotspots']],
            'shop the look no spots' => ['shop_the_look', ['media_id' => self::MEDIA, 'hotspots' => []], ['hotspots']],
            'trust badges' => ['trust_badges', ['items' => $items(7, fn ($i) => ['id' => "b{$i}", 'icon' => 'truck', 'title' => 'T', 'text' => '']), 'style' => 'column'], ['items', 'style']],
            'trust badge fields' => ['trust_badges', ['items' => [['id' => 'b1', 'icon' => 'rocket', 'title' => $text(61), 'text' => $text(121)]]], ['items.0.icon', 'items.0.title', 'items.0.text']],
            'recently viewed' => ['recently_viewed', ['title' => $text(121), 'limit' => 3], ['title', 'limit']],
            'recently viewed max' => ['recently_viewed', ['limit' => 13], ['limit']],
            'marquee' => ['marquee', ['items' => [['id' => 'm1', 'text' => ''], ['id' => 'm2', 'text' => $text(121)]], 'speed' => 'warp', 'direction' => 'up', 'separator' => 'heart'], ['items.0.text', 'items.1.text', 'speed', 'direction', 'separator']],
            'marquee 11' => ['marquee', ['items' => $items(11, fn ($i) => ['id' => "m{$i}", 'text' => 'x'])], ['items']],
        ];
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  list<string>  $paths
     */
    #[DataProvider('invalidProps')]
    public function test_invalid_props_are_refused_with_their_paths(string $type, array $props, array $paths): void
    {
        $this->assertEqualsCanonicalizing($paths, array_values(array_unique($this->errorPaths($type, $props))));
    }

    public function test_limits_at_their_bounds_are_accepted_and_numbers_are_kept(): void
    {
        $items = fn (int $n, callable $make) => array_map($make, range(1, $n));
        $text = fn (int $length) => str_repeat('অ', $length);

        [$accordion, $errors] = $this->element('accordion', ['items' => $items(20, fn ($i) => ['id' => "q{$i}", 'title' => $text(120), 'html' => '<p>'.str_repeat('a', 4993).'</p>'])], 'footer');
        $this->assertSame([], $errors);
        $this->assertCount(20, $accordion['props']['items']);

        [$counter, $errors] = $this->element('counter', ['items' => [
            ['id' => 'n1', 'value' => 1000000000, 'prefix' => '৳', 'suffix' => $text(8), 'label' => $text(60)],
            ['id' => 'n2', 'value' => 4.85, 'prefix' => '', 'suffix' => '', 'label' => 'x'],
            ['id' => 'n3', 'value' => 12.0, 'prefix' => '', 'suffix' => '', 'label' => 'x'],
        ]]);
        $this->assertSame([], $errors);
        $this->assertSame([1000000000, 4.85, 12], array_column($counter['props']['items'], 'value'));
        // Every key of an item is present (missing optional texts are empty).
        [$steps] = $this->element('steps', ['items' => [['id' => 'p1', 'title' => 'A'], ['id' => 'p2', 'title' => 'B']]]);
        $this->assertSame(['id' => 'p1', 'title' => 'A', 'text' => '', 'icon' => null], $steps['props']['items'][0]);

        [$look, $errors] = $this->element('shop_the_look', ['media_id' => strtoupper(self::MEDIA), 'hotspots' => [['id' => 'h1', 'x' => 0, 'y' => 100.0, 'product_id' => strtoupper(self::PRODUCT)], ['id' => 'h2', 'x' => 99.99, 'y' => 0.5, 'product_id' => self::PRODUCT_2]]]);
        $this->assertSame([], $errors);
        $this->assertSame(self::MEDIA, $look['props']['media_id']);
        $this->assertSame([['id' => 'h1', 'x' => 0, 'y' => 100, 'product_id' => self::PRODUCT], ['id' => 'h2', 'x' => 99.99, 'y' => 0.5, 'product_id' => self::PRODUCT_2]], $look['props']['hotspots']);
        // One product per photo spot.
        $this->assertSame(['hotspots.1.product_id'], $this->errorPaths('shop_the_look', ['media_id' => self::MEDIA, 'hotspots' => [['id' => 'h1', 'x' => 1, 'y' => 1, 'product_id' => self::PRODUCT], ['id' => 'h2', 'x' => 2, 'y' => 2, 'product_id' => self::PRODUCT]]]));

        [$gallery] = $this->element('gallery', ['images' => [['id' => 'g1', 'media_id' => self::MEDIA]], 'columns' => ['base' => 6, 'tablet' => null]]);
        $this->assertSame(['base' => 6], $gallery['props']['columns']);
        $this->assertSame(['id' => 'g1', 'media_id' => self::MEDIA, 'alt' => '', 'caption' => ''], $gallery['props']['images'][0]);
        [$card] = $this->element('category_card', ['category_id' => self::CATEGORY, 'title' => '  ', 'button_label' => null]);
        $this->assertSame(['category_id' => self::CATEGORY, 'media_id' => null, 'title' => null, 'button_label' => '', 'layout' => 'overlay'], $card['props']);
        [$map] = $this->element('map', ['query' => '23.7465,90.3760', 'height' => 600, 'zoom' => 3], 'footer');
        $this->assertSame(['query' => '23.7465,90.3760', 'title' => 'Find our store', 'height' => 600, 'zoom' => 3], $map['props']);
    }

    public function test_chart_props_follow_the_chart_contract(): void
    {
        $chart = fn (array $props) => $this->errorPaths('chart', $props + ElementRegistry::defaults('chart'));
        $this->assertSame([], $chart([]));
        $this->assertSame([], $chart(['kind' => 'bar', 'labels' => array_map(fn ($i) => "L{$i}", range(1, 24)), 'series' => array_map(fn ($s) => ['id' => "s{$s}", 'name' => "S{$s}", 'values' => array_fill(0, 24, -12.5)], range(1, 6)), 'y_starts_at_zero' => false, 'height' => 600, 'unit' => '৳', 'unit_position' => 'before', 'show_values' => 'all-small']));
        // Labels: 1–24 names of 1–40 characters.
        $this->assertSame(['labels'], $chart(['labels' => [], 'series' => [['id' => 's1', 'name' => 'A', 'values' => []]]]));
        $this->assertContains('labels', $chart(['labels' => array_map(fn ($i) => "L{$i}", range(1, 25)), 'series' => [['id' => 's1', 'name' => 'A', 'values' => array_fill(0, 25, 1)]]]));
        $this->assertSame(['labels.1', 'labels.2'], $chart(['labels' => ['A', '', str_repeat('x', 41)], 'series' => [['id' => 's1', 'name' => 'A', 'values' => [1, 2, 3]]]]));
        // Series: 1–6, each with a name and exactly one number per label.
        $this->assertSame(['series'], $chart(['series' => []]));
        $this->assertSame(['series'], $chart(['series' => array_map(fn ($s) => ['id' => "s{$s}", 'name' => 'S', 'values' => [1, 2, 3]], range(1, 7))]));
        $this->assertSame(['series.0.name', 'series.0.values', 'series.1.values.1', 'series.1.values.2'], $chart(['series' => [
            ['id' => 's1', 'name' => str_repeat('x', 41), 'values' => [1, 2]],
            ['id' => 's2', 'name' => 'B', 'values' => [1, '2', 1.0e13]],
        ]]));
        $this->assertSame(['series.1.id'], $chart(['series' => [['id' => 's1', 'name' => 'A', 'values' => [1, 2, 3]], ['id' => 's1', 'name' => 'B', 'values' => [1, 2, 3]]]]));
        // Pie and donut: one series, ≤ 8 slices, no negatives, not all zero.
        $this->assertSame([], $chart(['kind' => 'pie', 'labels' => array_map(fn ($i) => "L{$i}", range(1, 8)), 'series' => [['id' => 's1', 'name' => 'A', 'values' => [0, 1, 2, 3, 4, 5, 6, 7]]]]));
        $this->assertSame(['labels'], $chart(['kind' => 'donut', 'labels' => array_map(fn ($i) => "L{$i}", range(1, 9)), 'series' => [['id' => 's1', 'name' => 'A', 'values' => array_fill(0, 9, 1)]]]));
        $this->assertSame(['series'], $chart(['kind' => 'pie', 'series' => [['id' => 's1', 'name' => 'A', 'values' => [1, 2, 3]], ['id' => 's2', 'name' => 'B', 'values' => [1, 2, 3]]]]));
        $this->assertSame(['series.0.values.1'], $chart(['kind' => 'pie', 'series' => [['id' => 's1', 'name' => 'A', 'values' => [1, -2, 3]]]]));
        $this->assertSame(['series.0.values'], $chart(['kind' => 'donut', 'series' => [['id' => 's1', 'name' => 'A', 'values' => [0, 0, 0]]]]));
        // Settings.
        $this->assertEqualsCanonicalizing(['kind', 'title', 'description', 'unit', 'unit_position', 'y_starts_at_zero', 'show_values', 'show_legend', 'show_table', 'height'], $chart([
            'kind' => 'scatter', 'title' => '', 'description' => str_repeat('x', 301), 'unit' => 'kilograms', 'unit_position' => 'middle',
            'y_starts_at_zero' => 'yes', 'show_values' => 'every', 'show_legend' => null, 'show_table' => 1, 'height' => 601,
        ]));
        $this->assertSame(['height'], $chart(['height' => 199]));
        [$element] = $this->element('chart', ['series' => [['id' => 's1', 'name' => 'Orders', 'values' => [1, 2.5, 3]]]]);
        $this->assertSame([1, 2.5, 3], $element['props']['series'][0]['values']);
    }

    public function test_list_items_are_translated_by_item_id_and_unknown_keys_are_dropped(): void
    {
        [$element, $errors] = $this->element('accordion', [
            'items' => [['id' => 'q1', 'title' => 'Delivery?', 'html' => '<p>Fast.</p>'], ['id' => 'q2', 'title' => 'Returns?', 'html' => '']],
        ], 'page', ['translations' => ['bn' => [
            'items.q1.title' => 'ডেলিভারি?',
            'items.q2.html' => '<p>৭ দিন।</p>',
            'items.q9.title' => 'gone item',
            'items.q1.color' => 'not translatable',
            'title' => 'no such field',
            'items.q2.title' => '  ',
        ], 'fr' => ['items.q1.title' => 'Livraison?']]]);
        $this->assertSame([], $errors);
        $this->assertSame(['bn' => ['items.q1.title' => 'ডেলিভারি?', 'items.q2.html' => '<p>৭ দিন।</p>']], $element['translations']);

        [, $errors] = $this->element('marquee', ['items' => [['id' => 'm1', 'text' => 'Hi']]], 'header', ['translations' => ['bn' => ['items.m1.text' => str_repeat('a', 121)]]]);
        $this->assertSame('sections.0.columns.0.elements.0.translations.bn.items.m1.text', $errors[0]['path']);

        [$chart] = $this->element('chart', [], 'page', ['translations' => ['bn' => ['labels.0' => '২০২৩', 'labels.3' => 'too far', 'series.s1.name' => 'অর্ডার', 'title' => 'বৃদ্ধি']]]);
        $this->assertSame(['bn' => ['title' => 'বৃদ্ধি', 'series.s1.name' => 'অর্ডার', 'labels.0' => '২০২৩']], $chart['translations']);

        // The render tree shows them in the request's language, falling back per field.
        $props = BuilderPageRenderer::localizedProps('chart', $chart['props'], $chart['translations'], 'bn');
        $this->assertSame(['২০২৩', '2024', '2025'], $props['labels']);
        $this->assertSame('অর্ডার', $props['series'][0]['name']);
        $this->assertSame('বৃদ্ধি', $props['title']);
        $props = BuilderPageRenderer::localizedProps('accordion', $element['props'], $element['translations'], 'bn');
        $this->assertSame(['ডেলিভারি?', '<p>Fast.</p>', 'Returns?', '<p>৭ দিন।</p>'], [$props['items'][0]['title'], $props['items'][0]['html'], $props['items'][1]['title'], $props['items'][1]['html']]);
        $this->assertSame($element['props'], BuilderPageRenderer::localizedProps('accordion', $element['props'], $element['translations'], 'en'));
        // B4 nested keys are unchanged.
        $cta = BuilderPageRenderer::localizedProps('cta', ElementRegistry::defaults('cta'), ['bn' => ['primary.label' => 'কিনুন']], 'bn');
        $this->assertSame('কিনুন', $cta['primary']['label']);
    }

    public function test_motion_is_a_base_style_group_with_bounded_timing(): void
    {
        $this->assertSame(
            ['base' => ['motion' => ['entrance' => 'slide-up', 'duration' => 2000, 'delay' => 0]]],
            StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'slide-up', 'duration' => 2000, 'delay' => 0, 'easing' => 'bounce']], 'mobile' => ['motion' => ['entrance' => 'fade']]]),
        );
        $this->assertSame(['base' => ['motion' => ['entrance' => 'zoom']]], StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'zoom', 'duration' => 199, 'delay' => 2001]]]));
        $this->assertSame(['base' => ['motion' => ['entrance' => 'none', 'duration' => 200]]], StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'none', 'duration' => 200, 'delay' => 1.5]]]));
        $this->assertSame([], StyleSchema::normalize(['base' => ['motion' => ['entrance' => 'spin', 'duration' => 500]], 'tablet' => ['motion' => ['entrance' => 'fade']]]));

        // Any node: sections, columns and elements.
        $document = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => [[
            'id' => 's_m', 'style' => ['base' => ['motion' => ['entrance' => 'fade']]],
            'columns' => [['id' => 'c_m', 'width' => ['base' => 100], 'style' => ['base' => ['motion' => ['entrance' => 'slide-left', 'delay' => 300]]], 'elements' => [
                ['id' => 'e_m', 'type' => 'heading', 'props' => ['text' => 'Hi'], 'style' => ['base' => ['motion' => ['entrance' => 'zoom', 'duration' => 800]]]],
            ]]],
        ]]]);
        $section = $document['sections'][0];
        $this->assertSame(['entrance' => 'fade'], $section['style']['base']['motion']);
        $this->assertSame(['entrance' => 'slide-left', 'delay' => 300], $section['columns'][0]['style']['base']['motion']);
        $this->assertSame(['entrance' => 'zoom', 'duration' => 800], $section['columns'][0]['elements'][0]['style']['base']['motion']);
    }

    public function test_background_videos_belong_to_sections_and_inner_rows_at_base(): void
    {
        $video = ['url' => 'https://youtu.be/dQw4w9WgXcQ', 'poster' => ['media_id' => strtoupper(self::MEDIA)]];
        $expected = ['url' => 'https://youtu.be/dQw4w9WgXcQ', 'provider' => 'youtube', 'video_id' => 'dQw4w9WgXcQ', 'poster' => ['media_id' => self::MEDIA]];
        $style = ['base' => ['background' => ['type' => 'color', 'color' => '#000000', 'video' => $video]], 'mobile' => ['background' => ['type' => 'none', 'video' => $video]]];

        $this->assertSame(['base' => ['background' => ['type' => 'color', 'color' => '#000000', 'video' => $expected]], 'mobile' => ['background' => ['type' => 'none']]], StyleSchema::normalize($style, true));
        // Not on columns and plain elements; the poster is a style media id.
        $this->assertSame(['base' => ['background' => ['type' => 'color', 'color' => '#000000']], 'mobile' => ['background' => ['type' => 'none']]], StyleSchema::normalize($style));
        $this->assertSame([self::MEDIA], StyleSchema::mediaIds(StyleSchema::normalize($style, true)));
        // Vimeo, without a poster; unsupported links and bad posters are dropped.
        $this->assertSame(['url' => 'https://vimeo.com/76979871', 'provider' => 'vimeo', 'video_id' => '76979871'], StyleSchema::normalize(['base' => ['background' => ['type' => 'none', 'video' => ['url' => 'https://vimeo.com/76979871', 'poster' => ['media_id' => 'nope'], 'provider' => 'youtube', 'video_id' => 'x']]]], true)['base']['background']['video']);
        $this->assertSame(['base' => ['background' => ['type' => 'none']]], StyleSchema::normalize(['base' => ['background' => ['type' => 'none', 'video' => ['url' => 'https://example.com/clip.mp4']]]], true));

        $document = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => [[
            'id' => 's_v', 'style' => $style,
            'columns' => [['id' => 'c_v', 'width' => ['base' => 100], 'style' => $style, 'elements' => [
                ['id' => 'e_row', 'type' => 'inner_row', 'style' => $style, 'columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'elements' => [
                    ['id' => 'e_img', 'type' => 'spacer', 'style' => $style],
                ]]]],
            ]]],
        ]]]);
        $section = $document['sections'][0];
        $row = $section['columns'][0]['elements'][0];
        $this->assertSame($expected, $section['style']['base']['background']['video']);
        $this->assertSame($expected, $row['style']['base']['background']['video']);
        $this->assertArrayNotHasKey('video', $section['columns'][0]['style']['base']['background']);
        $this->assertArrayNotHasKey('video', $row['columns'][0]['elements'][0]['style']['base']['background']);
    }

    public function test_sections_may_be_sticky_once_and_have_shape_dividers(): void
    {
        $section = fn (string $id, array $props) => ['id' => $id, 'props' => $props, 'columns' => [['id' => "c{$id}", 'width' => ['base' => 100], 'elements' => []]]];
        $errors = function (array $sections, string $context = 'page') {
            try {
                BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => $sections], $context);

                return [];
            } catch (InvalidBuilderDocument $e) {
                return array_column($e->errors, 'message', 'path');
            }
        };

        // Without the new props a section normalizes exactly as before B6.
        $plain = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => [$section('s_a', ['layout' => 'full', 'sticky' => false, 'shape_top' => null])]]);
        $this->assertSame(['layout' => 'full', 'anchor' => null], $plain['sections'][0]['props']);

        $shape = ['shape' => 'wave', 'color' => 'THEME:primary', 'height' => 16, 'flip' => true];
        $document = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => [
            $section('s_a', ['sticky' => true, 'shape_top' => ['shape' => 'tilt', 'color' => '#FFFFFF'], 'shape_bottom' => ['shape' => 'zigzag', 'color' => 'theme:canvas', 'height' => 200, 'flip' => true]]),
            $section('s_b', ['shape_bottom' => ['shape' => 'curve', 'color' => '#00000080', 'height' => 16, 'flip' => false]]),
        ]], 'zone');
        $this->assertSame(['layout' => 'boxed', 'anchor' => null, 'sticky' => true, 'shape_top' => ['shape' => 'tilt', 'color' => '#ffffff', 'height' => 64, 'flip' => false], 'shape_bottom' => ['shape' => 'zigzag', 'color' => 'theme:canvas', 'height' => 200, 'flip' => true]], $document['sections'][0]['props']);
        $this->assertSame($document, BuilderDocumentSchema::normalize($document, 'zone'));

        $this->assertSame(['sections.1.props.sticky'], array_keys($errors([$section('s_a', ['sticky' => true]), $section('s_b', ['sticky' => true])])));
        $this->assertStringContainsString('Only one section', $errors([$section('s_a', ['sticky' => true]), $section('s_b', ['sticky' => true])])['sections.1.props.sticky']);
        $this->assertSame(['sections.0.props.sticky'], array_keys($errors([$section('s_a', ['sticky' => true])], 'header')));
        $this->assertSame(['sections.0.props.sticky'], array_keys($errors([$section('s_a', ['sticky' => 'yes'])])));
        $this->assertEqualsCanonicalizing(
            ['sections.0.props.shape_top.shape', 'sections.0.props.shape_top.color', 'sections.0.props.shape_top.height', 'sections.0.props.shape_top.flip', 'sections.0.props.shape_bottom'],
            array_keys($errors([$section('s_a', ['shape_top' => ['shape' => 'blob', 'color' => 'red', 'height' => 201, 'flip' => 'no'], 'shape_bottom' => 'wave'])])),
        );
        $this->assertSame(['sections.0.props.shape_top.height'], array_keys($errors([$section('s_a', ['shape_top' => ['shape' => 'wave', 'color' => '#000000', 'height' => 15]])])));
        $this->assertSame(['sections.0.props.shape_top.color'], array_keys($errors([$section('s_a', ['shape_top' => $shape])])));
    }

    public function test_b6_elements_outside_their_contexts_are_refused(): void
    {
        foreach (ElementRegistry::B6 as $type) {
            $props = self::minimal()[$type] ?? ElementRegistry::defaults($type);
            foreach (ElementRegistry::CONTEXTS as $context) {
                [, $errors] = $this->element($type, $props, $context);
                $refused = in_array('ELEMENT_NOT_ALLOWED', array_column($errors, 'code'), true);
                $this->assertSame(! in_array($context, ElementRegistry::allowedIn($type), true), $refused, "{$type} in {$context}");
                if (! $refused) {
                    $this->assertSame([], $errors, "{$type} in {$context}");
                }
            }
        }
    }
}
