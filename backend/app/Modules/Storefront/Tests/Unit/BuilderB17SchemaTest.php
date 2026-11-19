<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use Carbon\CarbonImmutable;
use Tests\TestCase;

/**
 * B17: the four new elements (ornament, payment badges, delivery promise, Bangla date) and the
 * trust badges extension in the registry and the schema, and the festival calendar's dates.
 */
class BuilderB17SchemaTest extends TestCase
{
    private const ZONE = '0199a5c1-0000-7000-8000-000000000001';

    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private function document(array $elements): array
    {
        return ['schema_version' => 1, 'sections' => [[
            'id' => 's_x', 'type' => 'section',
            'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    private function element(string $type, array $props, string $context = 'page', array $extra = []): array
    {
        return BuilderDocumentSchema::normalize($this->document([['id' => 'e_x', 'type' => $type, 'props' => $props] + $extra]), $context)['sections'][0]['columns'][0]['elements'][0];
    }

    /**
     * @param  array<string, mixed>  $props
     * @return list<string> error paths relative to the props
     */
    private function errors(string $type, array $props, string $context = 'page'): array
    {
        try {
            BuilderDocumentSchema::normalize($this->document([['id' => 'e_x', 'type' => $type, 'props' => $props]]), $context);
        } catch (InvalidBuilderDocument $e) {
            return array_map(fn (array $error) => str_replace('sections.0.columns.0.elements.0.props.', '', $error['path']), $e->errors);
        }

        return [];
    }

    public function test_the_registry_describes_the_b17_elements(): void
    {
        $meta = ElementRegistry::metadata();
        $byType = array_column($meta['types'], null, 'type');

        $this->assertSame(['media', 'commerce', 'commerce', 'content'], array_map(fn (string $t) => $byType[$t]['group'], ElementRegistry::B17));
        $this->assertSame([false, true, true, true], array_map(fn (string $t) => $byType[$t]['has_data'], ElementRegistry::B17));
        $this->assertEqualsCanonicalizing(['page', 'cms', 'header', 'footer', 'zone', 'popup', 'template'], ElementRegistry::allowedIn('ornament'));
        $this->assertEqualsCanonicalizing(['page', 'cms', 'header', 'footer', 'zone', 'popup', 'template'], ElementRegistry::allowedIn('bangla_date'));
        $this->assertEqualsCanonicalizing(['page', 'cms', 'zone', 'footer', 'template'], ElementRegistry::allowedIn('payment_badges'));
        $this->assertEqualsCanonicalizing(['page', 'cms', 'zone', 'footer', 'template'], ElementRegistry::allowedIn('delivery_promise'));
        $this->assertEqualsCanonicalizing(['page', 'cms', 'zone', 'footer', 'popup', 'template'], ElementRegistry::allowedIn('trust_badges'));

        $this->assertSame([], $byType['ornament']['translatable']);
        $this->assertSame(['title', 'note'], $byType['payment_badges']['translatable']);
        $this->assertSame(['title'], $byType['delivery_promise']['translatable']);
        $this->assertSame(['prefix'], $byType['bangla_date']['translatable']);
        $this->assertSame(['items.*.title', 'items.*.text'], $byType['trust_badges']['translatable']);

        $this->assertCount(16, $meta['enums']['ornament_names']);
        $this->assertSame(['alpona_border', 'flag_ribbon'], $meta['enums']['ornament_repeatable']);
        $this->assertSame(['bkash', 'nagad', 'rocket', 'upay'], $meta['enums']['payment_wallets']);
        $this->assertSame(['cards', 'list', 'bar'], $meta['enums']['delivery_layouts']);
        $this->assertSame(['min' => 1, 'max' => 8], $meta['limits']['lists']['trust_badges.items']);
        $this->assertSame(['min' => 16, 'max' => 480], $meta['limits']['ornament_size']);
        $this->assertSame(['title' => 80, 'note' => 200], $meta['limits']['translatable']['payment_badges']);
    }

    public function test_the_new_elements_normalize_and_report_bad_values(): void
    {
        foreach (ElementRegistry::B17 as $type) {
            $this->assertSame(ElementRegistry::defaults($type), $this->element($type, [])['props'], $type);
        }
        $this->assertSame(
            ['name' => 'alpona_border', 'color' => '#aa3300', 'secondary_color' => 'theme:accent', 'size' => 40, 'align' => 'center', 'flip' => 'vertical', 'opacity' => 60, 'repeat' => true],
            $this->element('ornament', ['name' => 'alpona_border', 'color' => '#AA3300', 'secondary_color' => 'theme:accent', 'size' => 40, 'flip' => 'vertical', 'opacity' => 60, 'repeat' => true, 'extra' => 1])['props'],
        );
        $this->assertSame(['name', 'color', 'secondary_color', 'size', 'align', 'flip', 'opacity'], $this->errors('ornament', [
            'name' => 'mosque', 'color' => 'red', 'secondary_color' => 'blue', 'size' => 8, 'align' => 'middle', 'flip' => 'x', 'opacity' => 0,
        ]));
        $this->assertSame(['repeat'], $this->errors('ornament', ['name' => 'lantern', 'repeat' => true]));
        $this->assertSame(['color'], $this->errors('ornament', ['color' => null]));

        $badges = $this->element('payment_badges', ['wallets' => ['nagad', 'bkash'], 'title' => 'যেভাবে টাকা দেবেন', 'style' => 'list'], 'footer', ['translations' => ['bn' => ['title' => 'যেভাবে', 'note' => 'বিকাশে সেন্ড মানি']]]);
        $this->assertSame(['nagad', 'bkash'], $badges['props']['wallets']);
        $this->assertSame(['bn' => ['title' => 'যেভাবে', 'note' => 'বিকাশে সেন্ড মানি']], $badges['translations']);
        $this->assertSame(['show_store_methods', 'wallets.1', 'wallets.2', 'note', 'style', 'align'], $this->errors('payment_badges', [
            'wallets' => ['bkash', 'paypal', 'bkash'], 'note' => str_repeat('x', 201), 'style' => 'grid', 'align' => 'top', 'show_store_methods' => 'yes',
        ]));
        $this->assertSame(['wallets'], $this->errors('payment_badges', ['wallets' => 'bkash']));

        $this->assertSame([self::ZONE], $this->element('delivery_promise', ['zones' => [strtoupper(self::ZONE)]])['props']['zones']);
        $this->assertSame(['zones'], $this->errors('delivery_promise', ['zones' => []]));
        $this->assertSame(['zones'], $this->errors('delivery_promise', ['zones' => 'some']));
        $this->assertSame(['zones.1', 'zones.2'], $this->errors('delivery_promise', ['zones' => [self::ZONE, 'nope', self::ZONE]]));
        $this->assertSame(['title', 'show_price', 'layout'], $this->errors('delivery_promise', ['layout' => 'grid', 'show_price' => 1, 'title' => str_repeat('x', 81)]));

        $this->assertSame(['prefix', 'show_hijri', 'style'], $this->errors('bangla_date', ['prefix' => str_repeat('x', 61), 'style' => 'big', 'show_hijri' => 'no']));

        // Popups take ornaments, trust badges and the date, not the store-data blocks.
        $this->assertSame('ornament', $this->element('ornament', [], 'popup')['type']);
        $this->assertSame('bangla_date', $this->element('bangla_date', [], 'popup')['type']);
        $this->assertSame(['type'], array_map(fn ($p) => substr($p, strrpos($p, '.') + 1), $this->errorsIn('payment_badges', 'popup')));
        $this->assertSame(['type'], array_map(fn ($p) => substr($p, strrpos($p, '.') + 1), $this->errorsIn('delivery_promise', 'header')));
    }

    /**
     * @return list<string>
     */
    private function errorsIn(string $type, string $context): array
    {
        try {
            BuilderDocumentSchema::normalize($this->document([['id' => 'e_x', 'type' => $type, 'props' => []]]), $context);
        } catch (InvalidBuilderDocument $e) {
            return array_column($e->errors, 'path');
        }

        return [];
    }

    public function test_trust_badges_take_up_to_eight_items_with_optional_links(): void
    {
        $items = array_map(fn (int $i) => ['id' => "b{$i}", 'icon' => 'truck', 'title' => "Badge {$i}", 'text' => ''], range(1, 8));
        $items[1]['link'] = ['url' => '/pages/returns'];
        $items[2]['link'] = null;
        $element = $this->element('trust_badges', ['items' => $items, 'style' => 'grid'], 'popup');
        $this->assertCount(8, $element['props']['items']);
        $this->assertSame(['url' => '/pages/returns'], $element['props']['items'][1]['link']);
        // No link: no key, so older documents normalize unchanged.
        $this->assertSame(['id', 'icon', 'title', 'text'], array_keys($element['props']['items'][0]));
        $this->assertSame(['id', 'icon', 'title', 'text'], array_keys($element['props']['items'][2]));
        $this->assertSame(ElementRegistry::defaults('trust_badges'), $this->element('trust_badges', ElementRegistry::defaults('trust_badges'))['props']);

        $this->assertSame(['items.0.link.url'], $this->errors('trust_badges', ['items' => [['id' => 'b1', 'icon' => 'truck', 'title' => 'T', 'text' => '', 'link' => ['url' => 'javascript:alert(1)']]]]));
    }

    public function test_the_festival_calendar_finds_the_next_dates(): void
    {
        $today = CarbonImmutable::parse('2026-11-15', 'Asia/Dhaka');
        $next = fn (string $key) => FestivalCalendar::next($key, $today);

        // Fixed dates: this year if not yet over, else next year.
        $this->assertSame(['year' => 2026, 'starts_on' => '2026-12-16', 'ends_on' => '2026-12-16', 'expected' => false, 'note' => null, 'note_bn' => null], $next('victory-day'));
        $this->assertSame('2027-11-11', $next('eleven-eleven')['starts_on']);
        $this->assertSame(['2027-04-14', '2027-02-21', '2027-03-26'], [$next('pohela-boishakh')['starts_on'], $next('ekushey')['starts_on'], $next('independence-day')['starts_on']]);
        // The winter sale spans the new year.
        $this->assertSame(['2026-12-01', '2027-01-31'], [$next('winter-sale')['starts_on'], $next('winter-sale')['ends_on']]);
        $this->assertSame(2026, FestivalCalendar::next('winter-sale', CarbonImmutable::parse('2027-01-20'))['year']);
        // Lunar and tithi occasions from the table, always expected.
        $this->assertSame(['2027-03-10', '2027-03-12', true], [$next('eid-ul-fitr')['starts_on'], $next('eid-ul-fitr')['ends_on'], $next('eid-ul-fitr')['expected']]);
        $this->assertSame(['2027-02-09', '2027-03-09'], [$next('ramadan')['starts_on'], $next('ramadan')['ends_on']]);
        $this->assertSame('2027-05-17', $next('eid-ul-adha')['starts_on']);
        $this->assertSame(['2027-10-06', '2027-10-10'], [$next('durga-puja')['starts_on'], $next('durga-puja')['ends_on']]);
        $this->assertStringContainsString('panjika', (string) $next('durga-puja')['note']);
        $this->assertStringContainsString('moon', (string) $next('eid-ul-fitr')['note']);
        // During an occasion it is still "next"; past the table there is none.
        $this->assertSame(2028, FestivalCalendar::next('eid-ul-fitr', CarbonImmutable::parse('2028-02-28'))['year']);
        $this->assertNull(FestivalCalendar::next('eid-ul-fitr', CarbonImmutable::parse('2028-06-01')));
        $this->assertSame('2028-02-29', FestivalCalendar::occurrence('eid-ul-fitr', 2028)['ends_on']);
        $this->assertNull(FestivalCalendar::occurrence('durga-puja', 2029));
        $this->assertNull(FestivalCalendar::occurrence('victory-day', 2025));
        // The day after: next year's.
        $this->assertSame('2027-11-11', FestivalCalendar::next('eleven-eleven', CarbonImmutable::parse('2026-11-12'))['starts_on']);
    }

    public function test_the_suggested_window_starts_before_the_occasion_and_is_at_most_60_days(): void
    {
        $today = CarbonImmutable::parse('2026-11-15');
        $window = FestivalCalendar::suggestedWindow('victory-day', FestivalCalendar::occurrence('victory-day', 2026), $today, 'Asia/Dhaka');
        $this->assertSame(['2026-12-09T00:00:00+06:00', '2026-12-16T23:59:59+06:00'], [$window['starts_at']->toIso8601String(), $window['ends_at']->toIso8601String()]);

        // Never before today.
        $window = FestivalCalendar::suggestedWindow('victory-day', FestivalCalendar::occurrence('victory-day', 2026), CarbonImmutable::parse('2026-12-12'), 'Asia/Dhaka');
        $this->assertSame('2026-12-12T00:00:00+06:00', $window['starts_at']->toIso8601String());

        // The two-month winter sale is cut to 60 days.
        $window = FestivalCalendar::suggestedWindow('winter-sale', FestivalCalendar::occurrence('winter-sale', 2026), $today, 'Asia/Dhaka');
        $this->assertSame(['2026-12-01T00:00:00+06:00', '2027-01-29T23:59:59+06:00'], [$window['starts_at']->toIso8601String(), $window['ends_at']->toIso8601String()]);
        $this->assertLessThanOrEqual(60 * 86400, $window['ends_at']->getTimestamp() - $window['starts_at']->getTimestamp());
    }
}
