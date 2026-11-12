<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\Builder\Templates\TemplateReferenceResolver;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * B8a: the selling blocks, trust & people elements and progress bars, the chart's stacked kinds
 * and store data sources — limits, money, link rules, nested list translations
 * (`plans.<id>.features.<id>.text`, `rows.<id>.cells.<column id>.text`), contexts, the
 * cross-side fixture sample-b8a-elements.v1.json and the ten B8a section templates.
 */
class BuilderB8aSchemaTest extends TestCase
{
    private const FIXTURE = '../frontend/src/storefront/builder/__fixtures__/sample-b8a-elements.v1.json';

    private const MEDIA = '0199a5c1-0000-7000-8000-00000000aa01';

    private const MEDIA_2 = '0199a5c1-0000-7000-8000-00000000aa02';

    private const MEDIA_3 = '0199a5c1-0000-7000-8000-00000000aa03';

    private const PRODUCT = '0199a5c1-0000-7000-8000-00000000bb01';

    private const PRODUCT_2 = '0199a5c1-0000-7000-8000-00000000bb02';

    private const PROMOTION = '0199a5c1-0000-7000-8000-00000000dd01';

    private const B8A_TEMPLATES = [
        'neutral-pricing-plans', 'neutral-before-after', 'neutral-comparison', 'neutral-flash-sale-bar', 'neutral-bundle',
        'neutral-team', 'neutral-review-wall', 'neutral-photo-grid', 'neutral-store-hours-map', 'neutral-ratings',
    ];

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
     * The normalized element, or the errors.
     *
     * @param  array<string, mixed>  $props
     * @param  array<string, mixed>  $extra
     * @return array{0: array<string, mixed>|null, 1: list<array<string, mixed>>}
     */
    private function element(string $type, array $props, string $context = 'page', array $extra = []): array
    {
        $document = ['schema_version' => 1, 'sections' => [[
            'id' => 's_x', 'type' => 'section',
            'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => [['id' => 'e_x', 'type' => $type, 'props' => $props] + $extra]]],
        ]]];
        try {
            return [BuilderDocumentSchema::normalize($document, $context)['sections'][0]['columns'][0]['elements'][0], []];
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

        return array_values(array_unique(array_map(fn (array $e) => (string) preg_replace('/^sections\.0\.columns\.0\.elements\.0\.props\.?/', '', $e['path']), $errors)));
    }

    /**
     * Valid props of the elements that need content first.
     *
     * @return array<string, array<string, mixed>>
     */
    private static function minimal(): array
    {
        return [
            'before_after' => ['before' => ['media_id' => self::MEDIA, 'alt' => 'Before'], 'after' => ['media_id' => self::MEDIA_2, 'alt' => 'After']],
            'bundle' => ['items' => [['id' => 'b1', 'product_id' => self::PRODUCT], ['id' => 'b2', 'product_id' => self::PRODUCT_2]]],
            'photo_grid' => ['images' => array_map(fn ($i) => ['id' => "g{$i}", 'media_id' => self::MEDIA, 'alt' => '', 'link' => null], [1, 2, 3])],
        ];
    }

    public function test_the_fixture_round_trips_unchanged_and_holds_every_b8a_feature(): void
    {
        $path = base_path(self::FIXTURE);
        $this->assertFileExists($path);
        $fixture = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);

        $normalized = BuilderDocumentSchema::normalize($fixture, 'page');
        $this->assertSame($this->canonical($fixture), $this->canonical($normalized));
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized, 'page'));

        $types = [];
        $charts = [];
        BuilderDocumentSchema::walk($fixture, function (array $node, string $p, string $kind) use (&$types, &$charts) {
            if ($kind === 'element') {
                $types[] = $node['type'];
                if ($node['type'] === 'chart') {
                    $charts[] = $node['props']['kind'].'|'.$node['props']['data_source'];
                }
            }
        });
        $this->assertSame([], array_values(array_diff(ElementRegistry::B8A, $types)));
        foreach (['stacked-column|manual', 'stacked-bar|manual'] as $chart) {
            $this->assertContains($chart, $charts);
        }
        $this->assertNotEmpty(array_filter($charts, fn (string $c) => str_contains($c, '|store.')));
        $json = (string) file_get_contents($path);
        foreach (['"plans.p1.features.f2.text"', '"rows.r2.cells.c1.text"', '"plans.p2.button.label"', '"before.alt"', '"profile.label"', '"members.m1.role"'] as $key) {
            $this->assertStringContainsString($key, $json);
        }
    }

    public function test_the_registry_describes_the_b8a_elements(): void
    {
        $meta = ElementRegistry::metadata();
        $byType = array_column($meta['types'], null, 'type');
        $this->assertSame(['layout', 'content', 'media', 'commerce', 'marketing', 'site'], $meta['enums']['groups']);
        $groups = [
            'commerce' => ['pricing_table', 'comparison_table', 'bundle'],
            'marketing' => ['flash_sale_bar', 'review_wall'],
            'media' => ['before_after', 'photo_grid'],
            'content' => ['team', 'store_hours', 'progress_bars'],
        ];
        foreach ($groups as $group => $types) {
            foreach ($types as $type) {
                $this->assertSame($group, $byType[$type]['group'], $type);
            }
        }
        foreach (ElementRegistry::B8A as $type) {
            $expected = $type === 'store_hours' ? ['page', 'cms', 'zone', 'footer'] : ['page', 'cms', 'zone'];
            $this->assertEqualsCanonicalizing($expected, ElementRegistry::allowedIn($type), $type);
            $this->assertSame(in_array($type, ['comparison_table', 'flash_sale_bar', 'bundle', 'review_wall', 'store_hours'], true), $byType[$type]['has_data'], $type);
        }
        $this->assertFalse($byType['chart']['has_data']);
        $this->assertSame(['chart' => 'data_source!=manual'], $meta['data_when']);
        $this->assertTrue(ElementRegistry::needsData('chart', ['data_source' => 'store.rating_breakdown']));
        $this->assertFalse(ElementRegistry::needsData('chart', ElementRegistry::defaults('chart')));

        $this->assertSame(['plans.*.name', 'plans.*.price_text', 'plans.*.period', 'plans.*.description', 'plans.*.badge', 'plans.*.button.label', 'plans.*.features.*.text'], $byType['pricing_table']['translatable']);
        $this->assertSame(['columns.*.title', 'rows.*.label', 'rows.*.cells.*.text'], $byType['comparison_table']['translatable']);
        $this->assertSame(['before_label', 'after_label', 'before.alt', 'after.alt'], $byType['before_after']['translatable']);
        $this->assertSame(['title', 'text', 'button.label'], $byType['flash_sale_bar']['translatable']);
        $this->assertSame(['profile.label', 'images.*.alt'], $byType['photo_grid']['translatable']);
        $this->assertSame(['members.*.role', 'members.*.bio'], $byType['team']['translatable']);
        $this->assertSame(['title', 'note'], $byType['store_hours']['translatable']);
        $this->assertSame(['items.*.label'], $byType['progress_bars']['translatable']);
        $this->assertSame(['min' => 0, 'max' => 12], $meta['limits']['lists']['pricing_table.plans.features']);
        $this->assertSame(['min' => 7, 'max' => 7], $meta['limits']['lists']['store_hours.days']);
        $this->assertContains('stacked-bar', $meta['enums']['chart_kinds']);
        $this->assertSame(ElementRegistry::CHART_DATA_SOURCES, $meta['enums']['chart_data_sources']);

        // Defaults normalize unchanged; elements that need content are valid once given it.
        foreach (ElementRegistry::B8A as $type) {
            $props = self::minimal()[$type] ?? null;
            [$element, $errors] = $this->element($type, $props ?? ElementRegistry::defaults($type));
            $this->assertSame([], $errors, $type);
            $this->assertSame(array_keys(ElementRegistry::defaults($type)), array_keys($element['props']), $type);
            if ($props === null) {
                $this->assertSame(ElementRegistry::defaults($type), $element['props'], $type);
            }
        }
        $this->assertContains('before.media_id', $this->errorPaths('before_after', []));
        $this->assertSame(['items'], $this->errorPaths('bundle', []));
        $this->assertSame(['images'], $this->errorPaths('photo_grid', []));
        $this->assertSame(['product_id'], $this->errorPaths('review_wall', ['source' => 'product']));
    }

    /**
     * @return array<string, array{0: string, 1: array<string, mixed>, 2: list<string>}>
     */
    public static function invalidProps(): array
    {
        $items = fn (int $n, callable $make) => array_map($make, range(1, $n));
        $text = fn (int $length) => str_repeat('a', $length);
        $plan = fn (array $extra = []) => $extra + ['id' => 'p1', 'name' => 'Plan', 'price' => '10', 'price_text' => '', 'period' => '', 'description' => '', 'features' => [], 'button' => null, 'highlighted' => false, 'badge' => ''];
        $column = fn (string $id, array $extra = []) => $extra + ['id' => $id, 'title' => 'T', 'product_id' => null, 'highlighted' => false];
        $member = fn (array $extra = []) => $extra + ['id' => 'm1', 'media_id' => null, 'name' => 'Rina', 'role' => '', 'bio' => '', 'links' => []];
        $image = fn ($i, array $extra = []) => $extra + ['id' => "g{$i}", 'media_id' => self::MEDIA, 'alt' => '', 'link' => null];
        $week = fn (array $changes = []) => array_map(fn (string $day) => ($changes[$day] ?? []) + ['day' => $day, 'closed' => false, 'open' => '10:00', 'close' => '21:00'], ElementRegistry::WEEKDAYS);

        return [
            'pricing no plans' => ['pricing_table', ['plans' => []], ['plans']],
            'pricing 5 plans' => ['pricing_table', ['plans' => $items(5, fn ($i) => $plan(['id' => "p{$i}"]))], ['plans']],
            'pricing money' => ['pricing_table', ['plans' => [
                $plan(['id' => 'p1', 'price' => '-1']), $plan(['id' => 'p2', 'price' => '10.999']), $plan(['id' => 'p3', 'price' => 10]), $plan(['id' => 'p4', 'price' => '1e3']),
            ]], ['plans.0.price', 'plans.1.price', 'plans.2.price', 'plans.3.price']],
            'pricing no price and no text' => ['pricing_table', ['plans' => [$plan(['price' => null, 'price_text' => ' '])]], ['plans.0.price_text']],
            'pricing fields' => ['pricing_table', ['plans' => [$plan([
                'name' => '', 'price_text' => $text(25), 'period' => $text(25), 'description' => $text(201), 'badge' => $text(25), 'highlighted' => 'yes',
                'button' => ['label' => $text(31), 'url' => 'javascript:alert(1)'],
                'features' => [['id' => 'f1', 'text' => '', 'included' => 'yes'], ['id' => 'f1', 'text' => $text(121), 'included' => true]],
            ])]], ['plans.0.name', 'plans.0.price_text', 'plans.0.period', 'plans.0.description', 'plans.0.badge', 'plans.0.highlighted', 'plans.0.button.label', 'plans.0.button.url', 'plans.0.features.0.text', 'plans.0.features.0.included', 'plans.0.features.1.id', 'plans.0.features.1.text']],
            'pricing 13 features' => ['pricing_table', ['plans' => [$plan(['features' => $items(13, fn ($i) => ['id' => "f{$i}", 'text' => 'x', 'included' => true])])]], ['plans.0.features']],
            'before after' => ['before_after', ['before' => ['media_id' => 'nope', 'alt' => $text(201)], 'after' => null, 'before_label' => $text(25), 'start' => 101, 'orientation' => 'diagonal', 'aspect' => '21:9'], ['before.media_id', 'before.alt', 'after.media_id', 'before_label', 'start', 'orientation', 'aspect']],
            'comparison one column' => ['comparison_table', ['columns' => [$column('c1')]], ['columns']],
            'comparison 5 columns, 21 rows' => ['comparison_table', ['columns' => $items(5, fn ($i) => $column("c{$i}")), 'rows' => $items(21, fn ($i) => ['id' => "r{$i}", 'label' => 'x', 'cells' => []])], ['columns', 'rows']],
            'comparison fields' => ['comparison_table', [
                'columns' => [$column('c1', ['title' => '', 'product_id' => self::PRODUCT]), $column('c2', ['product_id' => self::PRODUCT, 'highlighted' => 1])],
                'rows' => [['id' => 'r1', 'label' => $text(81), 'cells' => ['c1' => ['kind' => 'maybe', 'text' => ''], 'c2' => ['kind' => 'text', 'text' => '']]], ['id' => 'r2', 'label' => 'x', 'cells' => [1, 2]]],
                'show_prices' => 'yes',
            ], ['columns.0.title', 'columns.1.product_id', 'columns.1.highlighted', 'rows.0.label', 'rows.0.cells.c1.kind', 'rows.0.cells.c2.text', 'rows.1.cells', 'show_prices']],
            'comparison cell text' => ['comparison_table', ['rows' => [['id' => 'r1', 'label' => 'x', 'cells' => ['c1' => ['kind' => 'yes', 'text' => $text(61)], 'c2' => 'yes']]]], ['rows.0.cells.c1.text', 'rows.0.cells.c2']],
            'flash sale' => ['flash_sale_bar', ['promotion_id' => 'sale', 'title' => $text(81), 'text' => $text(161), 'show_products' => 'yes', 'product_limit' => 1, 'style' => 'banner', 'button' => ['label' => '', 'url' => '//evil.test']], ['promotion_id', 'title', 'text', 'show_products', 'product_limit', 'style', 'button.label', 'button.url']],
            'flash sale limit' => ['flash_sale_bar', ['product_limit' => 9, 'button' => 'Shop'], ['product_limit', 'button']],
            'bundle one item' => ['bundle', ['items' => [['id' => 'b1', 'product_id' => self::PRODUCT]]], ['items']],
            'bundle 5 items, same product' => ['bundle', ['items' => [...$items(4, fn ($i) => ['id' => "b{$i}", 'product_id' => sprintf('0199a5c1-0000-7000-8000-%012d', $i)]), ['id' => 'b5', 'product_id' => sprintf('0199a5c1-0000-7000-8000-%012d', 1)]]], ['items', 'items.4.product_id']],
            'bundle texts' => ['bundle', ['items' => [['id' => 'b1', 'product_id' => self::PRODUCT], ['id' => 'b2', 'product_id' => null]], 'title' => $text(81), 'text' => $text(201), 'button_label' => ''], ['items.1.product_id', 'title', 'text', 'button_label']],
            'team none' => ['team', ['members' => []], ['members']],
            'team 13' => ['team', ['members' => $items(13, fn ($i) => $member(['id' => "m{$i}"]))], ['members']],
            'team fields' => ['team', ['members' => [$member(['media_id' => 'x', 'name' => '', 'role' => $text(81), 'bio' => $text(301)])], 'columns' => ['base' => 5, 'mobile' => 0], 'style' => 'round'], ['members.0.media_id', 'members.0.name', 'members.0.role', 'members.0.bio', 'columns.base', 'columns.mobile', 'style']],
            'team links' => ['team', ['members' => [$member(['links' => [
                ['id' => 'l1', 'kind' => 'instagram', 'url' => 'http://instagram.com/x'],
                ['id' => 'l2', 'kind' => 'email', 'url' => 'hello@example.com'],
                ['id' => 'l3', 'kind' => 'email', 'url' => 'mailto:not-an-address'],
                ['id' => 'l4', 'kind' => 'website', 'url' => '/about'],
                ['id' => 'l5', 'kind' => 'myspace', 'url' => 'https://myspace.com/x'],
            ]])]], ['members.0.links.0.url', 'members.0.links.1.url', 'members.0.links.2.url', 'members.0.links.3.url', 'members.0.links.4.kind']],
            'team 6 links' => ['team', ['members' => [$member(['links' => $items(6, fn ($i) => ['id' => "l{$i}", 'kind' => 'website', 'url' => 'https://example.com'])])]], ['members.0.links']],
            'review wall' => ['review_wall', ['source' => 'best', 'product_id' => 'x', 'min_rating' => 0, 'limit' => 13, 'layout' => 'list', 'show_product' => null, 'show_summary' => 1, 'title' => $text(121)], ['source', 'product_id', 'min_rating', 'limit', 'layout', 'show_product', 'show_summary', 'title']],
            'review wall bounds' => ['review_wall', ['min_rating' => 6, 'limit' => 2], ['min_rating', 'limit']],
            'photo grid two' => ['photo_grid', ['images' => [$image(1), $image(2)]], ['images']],
            'photo grid 25' => ['photo_grid', ['images' => $items(25, fn ($i) => $image($i))], ['images']],
            'photo grid fields' => ['photo_grid', ['images' => [$image(1, ['media_id' => null, 'alt' => $text(201), 'link' => ['url' => 'ftp://x']]), $image(2), $image(3)], 'columns' => ['base' => 2, 'tablet' => 7], 'gap' => 'lg', 'profile' => ['label' => '', 'url' => 'javascript:x'], 'hover' => 'spin'], ['images.0.media_id', 'images.0.alt', 'images.0.link.url', 'columns.base', 'columns.tablet', 'gap', 'profile.label', 'profile.url', 'hover']],
            'store hours six days' => ['store_hours', ['days' => array_slice($week(), 0, 6)], ['days']],
            'store hours fields' => ['store_hours', ['days' => $week(['mon' => ['open' => '24:00'], 'tue' => ['close' => '9:00'], 'wed' => ['closed' => 'no'], 'thu' => ['day' => 'fri']]), 'title' => $text(81), 'note' => $text(201), 'show_open_now' => 'yes', 'week_starts' => 'tue'], ['days.0.open', 'days.1.close', 'days.2.closed', 'days.3.day', 'title', 'note', 'show_open_now', 'week_starts']],
            'store hours order' => ['store_hours', ['days' => array_reverse($week())], ['days.0.day', 'days.1.day', 'days.2.day', 'days.4.day', 'days.5.day', 'days.6.day']],
            'progress none' => ['progress_bars', ['items' => []], ['items']],
            'progress 11' => ['progress_bars', ['items' => $items(11, fn ($i) => ['id' => "i{$i}", 'label' => 'x', 'value' => 1])], ['items']],
            'progress fields' => ['progress_bars', ['items' => [
                ['id' => 'i1', 'label' => '', 'value' => 101], ['id' => 'i2', 'label' => $text(61), 'value' => 50.25], ['id' => 'i3', 'label' => 'x', 'value' => '50'],
            ], 'style' => 'pie', 'show_value' => 'x', 'animate' => null], ['items.0.label', 'items.0.value', 'items.1.label', 'items.1.value', 'items.2.value', 'style', 'show_value', 'animate']],
        ];
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  list<string>  $paths
     */
    #[DataProvider('invalidProps')]
    public function test_invalid_props_are_refused_with_their_paths(string $type, array $props, array $paths): void
    {
        $this->assertEqualsCanonicalizing($paths, $this->errorPaths($type, $props));
    }

    public function test_limits_at_their_bounds_are_accepted_and_values_are_kept(): void
    {
        $text = fn (int $length) => str_repeat('অ', $length);
        $plans = array_map(fn ($i) => [
            'id' => "p{$i}", 'name' => $text(60), 'price' => ['0', '999999999999.99', '12.5', '0.00'][$i - 1], 'price_text' => $text(24), 'period' => $text(24),
            'description' => $text(200), 'badge' => $text(24), 'highlighted' => $i === 2,
            'features' => array_map(fn ($f) => ['id' => "f{$f}", 'text' => $text(120), 'included' => $f % 2 === 0], range(1, 12)),
            'button' => ['label' => $text(30), 'url' => 'https://example.com/plan'],
        ], range(1, 4));
        [$pricing, $errors] = $this->element('pricing_table', ['plans' => $plans]);
        $this->assertSame([], $errors);
        // Prices stay strings exactly as given (never floats).
        $this->assertSame(['0', '999999999999.99', '12.5', '0.00'], array_column($pricing['props']['plans'], 'price'));
        $this->assertCount(12, $pricing['props']['plans'][0]['features']);

        // A free plan shows its text; a missing feature list is empty; a plan button is flat {label, url}.
        [$free] = $this->element('pricing_table', ['plans' => [['id' => 'p1', 'name' => 'Free', 'price' => null, 'price_text' => 'Ask us', 'button' => ['label' => 'Call', 'url' => '/pages/contact', 'link' => ['url' => '/x']]]]]);
        $this->assertSame(['id' => 'p1', 'name' => 'Free', 'price' => null, 'price_text' => 'Ask us', 'period' => '', 'description' => '', 'features' => [], 'button' => ['label' => 'Call', 'url' => '/pages/contact'], 'highlighted' => false, 'badge' => ''], $free['props']['plans'][0]);

        // Comparison: cells in column order, missing ones filled, unknown columns dropped.
        [$compare, $errors] = $this->element('comparison_table', [
            'columns' => [['id' => 'c1', 'title' => 'A', 'product_id' => strtoupper(self::PRODUCT)], ['id' => 'c2', 'title' => 'B'], ['id' => 'c3', 'title' => 'C'], ['id' => 'c4', 'title' => 'D', 'product_id' => self::PRODUCT_2]],
            'rows' => [['id' => 'r1', 'label' => 'Size', 'cells' => ['c3' => ['kind' => 'yes', 'text' => 'big'], 'c1' => ['kind' => 'text', 'text' => 'Small'], 'c9' => ['kind' => 'yes', 'text' => '']]]],
        ]);
        $this->assertSame([], $errors);
        $this->assertSame(self::PRODUCT, $compare['props']['columns'][0]['product_id']);
        $this->assertSame([
            'c1' => ['kind' => 'text', 'text' => 'Small'], 'c2' => ['kind' => 'no', 'text' => ''], 'c3' => ['kind' => 'yes', 'text' => 'big'], 'c4' => ['kind' => 'no', 'text' => ''],
        ], $compare['props']['rows'][0]['cells']);

        // Store hours: after midnight and open == close (24 hours) are fine; days stay Mon → Sun.
        $days = array_map(fn (string $day) => ['day' => $day, 'closed' => $day === 'fri', 'open' => $day === 'sat' ? '18:00' : '00:00', 'close' => $day === 'sat' ? '02:00' : '00:00'], ElementRegistry::WEEKDAYS);
        [$hours, $errors] = $this->element('store_hours', ['days' => $days, 'week_starts' => 'mon'], 'footer');
        $this->assertSame([], $errors);
        $this->assertSame($days, $hours['props']['days']);

        // Team links: https social, http(s) website, mailto e-mail.
        [$team, $errors] = $this->element('team', ['members' => [['id' => 'm1', 'name' => 'Rina', 'media_id' => strtoupper(self::MEDIA_3), 'links' => [
            ['id' => 'l1', 'kind' => 'x', 'url' => 'https://x.com/rina'], ['id' => 'l2', 'kind' => 'website', 'url' => 'http://rina.example.com'], ['id' => 'l3', 'kind' => 'email', 'url' => 'mailto:rina@example.com'],
        ]]], 'columns' => ['base' => 4, 'tablet' => null]]);
        $this->assertSame([], $errors);
        $this->assertSame(['id' => 'm1', 'media_id' => self::MEDIA_3, 'name' => 'Rina', 'role' => '', 'bio' => '', 'links' => [
            ['id' => 'l1', 'kind' => 'x', 'url' => 'https://x.com/rina'], ['id' => 'l2', 'kind' => 'website', 'url' => 'http://rina.example.com'], ['id' => 'l3', 'kind' => 'email', 'url' => 'mailto:rina@example.com'],
        ]], $team['props']['members'][0]);
        $this->assertSame(['base' => 4], $team['props']['columns']);

        // Progress values: at most one decimal, whole numbers as integers.
        [$progress] = $this->element('progress_bars', ['items' => [['id' => 'i1', 'label' => 'A', 'value' => 0], ['id' => 'i2', 'label' => 'B', 'value' => 99.5], ['id' => 'i3', 'label' => 'C', 'value' => 100.0]]]);
        $this->assertSame([0, 99.5, 100], array_column($progress['props']['items'], 'value'));

        // Review wall: a product only matters for the product source; flash sale without a promotion.
        [$wall] = $this->element('review_wall', ['source' => 'latest', 'product_id' => strtoupper(self::PRODUCT)]);
        $this->assertSame(self::PRODUCT, $wall['props']['product_id']);
        [$flash] = $this->element('flash_sale_bar', ['promotion_id' => strtoupper(self::PROMOTION), 'button' => null, 'product_limit' => 8]);
        $this->assertSame([self::PROMOTION, null, 8], [$flash['props']['promotion_id'], $flash['props']['button'], $flash['props']['product_limit']]);
    }

    public function test_chart_stacked_kinds_and_store_sources(): void
    {
        $chart = fn (array $props) => $this->errorPaths('chart', $props + ElementRegistry::defaults('chart'));
        $two = [['id' => 's1', 'name' => 'A', 'values' => [1, 2, 3]], ['id' => 's2', 'name' => 'B', 'values' => [0, 2.5, 3]]];
        $this->assertSame([], $chart(['kind' => 'stacked-column', 'series' => $two]));
        $this->assertSame([], $chart(['kind' => 'stacked-bar', 'series' => array_map(fn ($s) => ['id' => "s{$s}", 'name' => 'S', 'values' => [1, 2, 3]], range(1, 6))]));
        // Stacked: 2–6 series, no negative values.
        $this->assertSame(['series'], $chart(['kind' => 'stacked-column', 'series' => [['id' => 's1', 'name' => 'A', 'values' => [1, 2, 3]]]]));
        $this->assertSame(['series.1.values.0'], $chart(['kind' => 'stacked-bar', 'series' => [$two[0], ['id' => 's2', 'name' => 'B', 'values' => [-1, 2, 3]]]]));
        // Negative values are still fine for the other kinds.
        $this->assertSame([], $chart(['kind' => 'column', 'series' => [['id' => 's1', 'name' => 'A', 'values' => [-1, 2, 3]]]]));

        // Data sources: manual (default) or a store source; a ratings chart may name one product.
        $this->assertSame(['data_source'], $chart(['data_source' => 'store.sales']));
        $this->assertSame(['data_source'], $chart(['kind' => 'stacked-column', 'series' => $two, 'data_source' => 'store.products_per_category']));
        $this->assertSame(['source_product_id'], $chart(['data_source' => 'store.rating_breakdown', 'source_product_id' => 'x']));
        [$ratings] = $this->element('chart', ['data_source' => 'store.rating_breakdown', 'source_product_id' => strtoupper(self::PRODUCT)]);
        $this->assertSame(['store.rating_breakdown', self::PRODUCT], [$ratings['props']['data_source'], $ratings['props']['source_product_id']]);
        // The product only belongs to the ratings source; old documents get the manual source.
        [$categories] = $this->element('chart', ['data_source' => 'store.products_per_category', 'source_product_id' => self::PRODUCT]);
        $this->assertNull($categories['props']['source_product_id']);
        $legacy = ElementRegistry::defaults('chart');
        unset($legacy['data_source'], $legacy['source_product_id']);
        [$old] = $this->element('chart', $legacy);
        $this->assertSame(['manual', null], [$old['props']['data_source'], $old['props']['source_product_id']]);
    }

    public function test_nested_translations_are_kept_dropped_and_localized(): void
    {
        [$pricing, $errors] = $this->element('pricing_table', ['plans' => [
            ['id' => 'p1', 'name' => 'Basic', 'price' => '100', 'features' => [['id' => 'f1', 'text' => 'Delivery', 'included' => true]], 'button' => ['label' => 'Buy', 'url' => '/shop']],
            ['id' => 'p2', 'name' => 'Free', 'price' => null, 'price_text' => 'Free', 'button' => null],
        ]], 'page', ['translations' => ['bn' => [
            'plans.p1.name' => 'বেসিক',
            'plans.p1.features.f1.text' => 'ডেলিভারি',
            'plans.p1.button.label' => 'কিনুন',
            'plans.p2.button.label' => 'no button',
            'plans.p1.features.f9.text' => 'gone feature',
            'plans.p9.name' => 'gone plan',
            'plans.p2.price_text' => 'ফ্রি',
        ]]]);
        $this->assertSame([], $errors);
        $this->assertSame(['bn' => ['plans.p1.name' => 'বেসিক', 'plans.p2.price_text' => 'ফ্রি', 'plans.p1.button.label' => 'কিনুন', 'plans.p1.features.f1.text' => 'ডেলিভারি']], $pricing['translations']);
        $props = BuilderPageRenderer::localizedProps('pricing_table', $pricing['props'], $pricing['translations'], 'bn');
        $this->assertSame(['বেসিক', 'ডেলিভারি', 'কিনুন', 'ফ্রি', null], [$props['plans'][0]['name'], $props['plans'][0]['features'][0]['text'], $props['plans'][0]['button']['label'], $props['plans'][1]['price_text'], $props['plans'][1]['button']]);
        $this->assertSame($pricing['props'], BuilderPageRenderer::localizedProps('pricing_table', $pricing['props'], $pricing['translations'], 'en'));

        [$compare] = $this->element('comparison_table', ElementRegistry::defaults('comparison_table'), 'page', ['translations' => ['bn' => [
            'rows.r2.cells.c1.text' => '৬ মাস', 'rows.r2.cells.c9.text' => 'gone column', 'columns.c2.title' => 'প্রিমিয়াম', 'rows.r1.label' => 'ফ্রি ডেলিভারি',
        ]]]);
        $this->assertSame(['bn' => ['columns.c2.title' => 'প্রিমিয়াম', 'rows.r1.label' => 'ফ্রি ডেলিভারি', 'rows.r2.cells.c1.text' => '৬ মাস']], $compare['translations']);
        $props = BuilderPageRenderer::localizedProps('comparison_table', $compare['props'], $compare['translations'], 'bn');
        $this->assertSame(['kind' => 'text', 'text' => '৬ মাস'], $props['rows'][1]['cells']['c1']);
        $this->assertSame('1 year', $props['rows'][1]['cells']['c2']['text']);

        // Too long is refused at its path.
        [, $errors] = $this->element('comparison_table', ElementRegistry::defaults('comparison_table'), 'page', ['translations' => ['bn' => ['rows.r1.cells.c2.text' => str_repeat('a', 61)]]]);
        $this->assertSame('sections.0.columns.0.elements.0.translations.bn.rows.r1.cells.c2.text', $errors[0]['path']);

        // Nested props (B4 style) and list items.
        [$before] = $this->element('before_after', self::minimal()['before_after'], 'page', ['translations' => ['bn' => ['before.alt' => 'আগে', 'after_label' => 'পরে']]]);
        $props = BuilderPageRenderer::localizedProps('before_after', $before['props'], $before['translations'], 'bn');
        $this->assertSame(['আগে', 'After', 'পরে'], [$props['before']['alt'], $props['after']['alt'], $props['after_label']]);
        [$team] = $this->element('team', ElementRegistry::defaults('team'), 'page', ['translations' => ['bn' => ['members.m1.role' => 'প্রতিষ্ঠাতা', 'members.m1.name' => 'names are not translated']]]);
        $this->assertSame(['bn' => ['members.m1.role' => 'প্রতিষ্ঠাতা']], $team['translations']);
    }

    public function test_b8a_elements_outside_their_contexts_are_refused(): void
    {
        foreach (ElementRegistry::B8A as $type) {
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

    public function test_the_b8a_templates_use_the_new_elements_with_bangla(): void
    {
        $library = app(BuilderTemplateLibrary::class);
        $types = [];
        foreach (self::B8A_TEMPLATES as $id) {
            $meta = $library->find($id);
            $this->assertNotNull($meta, $id);
            $this->assertSame(['section', null, "/builder-templates/{$id}.png", null], [$meta['scope'], $meta['preset'], $meta['thumbnail'], $meta['preview']], $id);
            $this->assertFileExists(base_path("../frontend/public/builder-templates/{$id}.png"), $id);
            $sections = $library->sections($id, 'page');
            array_push($types, ...PortableTemplate::elementTypes($sections));
            // Every element carries Bangla.
            foreach (json_decode((string) json_encode($sections), true) as $section) {
                BuilderDocumentSchema::walk(['sections' => [$section]], function (array $node, string $path, string $kind) use ($id) {
                    if ($kind === 'element') {
                        $this->assertNotEmpty($node['translations']['bn'] ?? null, "{$id} {$node['type']}");
                    }
                });
            }
        }
        $this->assertSame([], array_values(array_diff(ElementRegistry::B8A, $types)));
        $this->assertContains('map', $types);
        $this->assertContains('chart', $types);
        $ratings = $library->sections('neutral-ratings', 'page');
        $this->assertSame('store.rating_breakdown', $ratings[0]['columns'][0]['elements'][0]['props']['data_source']);

        // The bundle names the store's newest products; a store with fewer than two products gets no bundle.
        $resolver = fn (int $products) => new class($products) implements TemplateReferenceResolver
        {
            public function __construct(private readonly int $products) {}

            public function media(string $asset): string
            {
                return '0199a5c1-0000-7000-8000-00000000ee01';
            }

            public function banner(array $attributes): string
            {
                return '0199a5c1-0000-7000-8000-00000000ee02';
            }

            public function menu(string $ref): ?string
            {
                return null;
            }

            public function product(string $source, int $index): ?string
            {
                return $index < $this->products ? sprintf('0199a5c1-0000-7000-8000-%012d', $index + 1) : null;
            }

            public function promotion(string $ref): ?string
            {
                return null;
            }
        };
        $n = 0;
        $newId = function (string $prefix) use (&$n) {
            return $prefix.'_t'.(++$n);
        };
        $bundle = $library->sections('neutral-bundle', 'page');
        $two = PortableTemplate::concrete($bundle, $resolver(2), $newId);
        $this->assertSame([sprintf('0199a5c1-0000-7000-8000-%012d', 1), sprintf('0199a5c1-0000-7000-8000-%012d', 2)], array_column($two[0]['columns'][0]['elements'][0]['props']['items'], 'product_id'));
        $this->assertSame([], PortableTemplate::concrete($bundle, $resolver(1), $newId)[0]['columns'][0]['elements']);
    }
}
