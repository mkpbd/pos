<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\SectionType;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * B4: the new element types (contract §2), document contexts (`allowed_in`) and the three
 * cross-side fixtures (sample-header, sample-footer, sample-b4-elements), which the storefront
 * validates with the same expectations.
 */
class BuilderB4SchemaTest extends TestCase
{
    private const FIXTURES = '../frontend/src/storefront/builder/__fixtures__/';

    /**
     * @return array<string, mixed>
     */
    private function fixture(string $name): array
    {
        $path = base_path(self::FIXTURES.$name);
        $this->assertFileExists($path);

        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

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
     * A one-section document holding the element.
     *
     * @param  array<string, mixed>  $element
     * @return array<string, mixed>
     */
    private function doc(array $element): array
    {
        return ['schema_version' => 1, 'sections' => [[
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
     * @return list<string> error paths relative to the element
     */
    private function errorPaths(string $type, array $props, string $context = 'page'): array
    {
        [, $errors] = $this->element($type, $props, $context);

        return array_map(fn (array $e) => (string) preg_replace('/^sections\.0\.columns\.0\.elements\.0\./', '', $e['path']), $errors);
    }

    public function test_the_fixtures_round_trip_unchanged_in_their_context(): void
    {
        $header = $this->fixture('sample-header.v1.json');
        $this->assertSame($this->canonical($header), $this->canonical(BuilderDocumentSchema::normalize($header, 'header')));

        $footer = $this->fixture('sample-footer.v1.json');
        $this->assertSame($this->canonical($footer), $this->canonical(BuilderDocumentSchema::normalize($footer, 'footer')));

        // The elements fixture: page elements (+ FAQ list, contact form) on a CMS page, the
        // header-only and footer-only parts in their own sections.
        $elements = $this->fixture('sample-b4-elements.v1.json');
        $contexts = ['s_page' => 'cms', 's_header_parts' => 'header', 's_footer_parts' => 'footer'];
        $types = [];
        foreach ($elements['sections'] as $section) {
            $document = ['schema_version' => 1, 'sections' => [$section]];
            $this->assertSame($this->canonical($document), $this->canonical(BuilderDocumentSchema::normalize($document, $contexts[$section['id']])), $section['id']);
            array_push($types, ...array_column($section['columns'][0]['elements'], 'type'));
        }
        // One of every B4 element.
        $this->assertSame([], array_values(array_diff(ElementRegistry::B4, $types)));
        $this->assertSame([], array_values(array_diff($types, ElementRegistry::B4)));

        // Normalizing twice changes nothing.
        $once = BuilderDocumentSchema::normalize($header, 'header');
        $this->assertSame($once, BuilderDocumentSchema::normalize($once, 'header'));
    }

    public function test_elements_outside_their_contexts_are_refused_with_the_node_path(): void
    {
        try {
            BuilderDocumentSchema::normalize($this->fixture('sample-b4-elements.v1.json'));
            $this->fail('The page accepted header and CMS elements.');
        } catch (InvalidBuilderDocument $e) {
            $refused = array_column(array_filter($e->errors, fn (array $error) => ($error['code'] ?? null) === 'ELEMENT_NOT_ALLOWED'), 'node_id');
            $this->assertEqualsCanonicalizing(['e_faq', 'e_contact_form', 'e_logo', 'e_menu', 'e_account', 'e_wishlist', 'e_cart', 'e_language', 'e_announcement', 'e_footer_menu', 'e_copyright'], $refused);
            $error = array_values(array_filter($e->errors, fn (array $error) => $error['node_id'] === 'e_faq'))[0];
            $this->assertSame('sections.0.columns.0.elements.14.type', $error['path']);
        }

        $cases = [
            // type, allowed contexts, refused contexts
            ['hero_slider', ['page', 'cms', 'zone'], ['header', 'footer', 'popup']],
            ['heading', ['page', 'cms', 'zone', 'header', 'footer', 'popup'], []],
            ['search_box', ['page', 'cms', 'zone', 'header'], ['footer']],
            ['newsletter_form', ['page', 'cms', 'zone', 'footer', 'popup'], ['header']],
            ['cart_icon', ['header'], ['page', 'cms', 'zone', 'footer']],
            ['copyright', ['footer'], ['page', 'cms', 'zone', 'header']],
            ['faq_list', ['cms'], ['page', 'zone', 'header', 'footer']],
            ['custom_html', ['page', 'cms', 'zone', 'header', 'footer', 'popup'], []],
        ];
        foreach ($cases as [$type, $allowed, $refused]) {
            $this->assertEqualsCanonicalizing($allowed, ElementRegistry::allowedIn($type), $type);
            foreach ($refused as $context) {
                [, $errors] = $this->element($type, [], $context);
                $this->assertContains('ELEMENT_NOT_ALLOWED', array_column($errors, 'code'), "{$type} in {$context}");
            }
        }
        [$ok] = $this->element('cart_icon', ['show_count' => false, 'show_total' => true], 'header');
        $this->assertSame(['show_count' => false, 'show_total' => true], $ok['props']);

        $this->expectException(\InvalidArgumentException::class);
        BuilderDocumentSchema::normalize(BuilderDocumentSchema::blank(), 'sidebar');
    }

    public function test_the_registry_lists_contexts_icons_and_the_b4_defaults(): void
    {
        $meta = ElementRegistry::metadata();
        $byType = array_column($meta['types'], null, 'type');
        foreach ($meta['types'] as $type) {
            $this->assertNotEmpty($type['allowed_in'], $type['type']);
            $this->assertSame([], array_diff($type['allowed_in'], ElementRegistry::CONTEXTS));
        }
        $this->assertSame(['page', 'cms', 'zone'], $byType['product_grid']['allowed_in']);
        $this->assertSame(['header', 'footer'], $byType['logo']['allowed_in']);
        $this->assertSame(['cms'], $byType['contact_form']['allowed_in']);
        $this->assertSame([
            'truck', 'shield-check', 'credit-card', 'headset', 'gift', 'rotate-ccw', 'badge-percent', 'clock', 'leaf', 'heart', 'star', 'store',
            'phone', 'mail', 'map-pin', 'instagram', 'facebook', 'youtube', 'check', 'sparkles',
        ], $meta['enums']['icons']);
        $this->assertSame(SectionType::FEATURE_ICONS, array_slice($meta['enums']['icons'], 0, count(SectionType::FEATURE_ICONS)));
        $this->assertSame(['title', 'text', 'primary.label', 'secondary.label'], $byType['cta']['translatable']);
        $this->assertSame([], $byType['logo']['translatable']);
        $this->assertSame('site', $byType['cart_icon']['group']);
        $this->assertEquals((object) [], $byType['announcement']['props']);
        $this->assertSame(['header' => ['none', 'dropdown', 'mega'], 'footer' => ['none', 'list']], $meta['enums']['menu_children']);
        $this->assertTrue($byType['countdown']['has_data']);
        $this->assertFalse($byType['contact_form']['has_data']);

        // Defaults that need no content normalize unchanged in their first context.
        foreach (['icon', 'cta', 'search_box', 'logo', 'account_link', 'wishlist_link', 'cart_icon', 'language_switch', 'announcement', 'social_icons', 'payment_icons', 'contact_block', 'copyright', 'newsletter_form', 'faq_list', 'contact_form'] as $type) {
            [$element, $errors] = $this->element($type, ElementRegistry::defaults($type), ElementRegistry::allowedIn($type)[0]);
            $this->assertSame([], $errors, $type);
            $this->assertSame(ElementRegistry::defaults($type), $element['props'], $type);
        }
        // Missing props take the defaults.
        [$element] = $this->element('newsletter_form', [], 'footer');
        $this->assertSame(['title' => 'Join our newsletter', 'text' => '', 'button_label' => 'Subscribe', 'layout' => 'inline'], $element['props']);
    }

    /**
     * @return array<string, array{0: string, 1: string, 2: string}>
     */
    public static function videoUrls(): array
    {
        return [
            'watch' => ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
            'watch with more parameters' => ['https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s', 'youtube', 'dQw4w9WgXcQ'],
            'mobile' => ['https://m.youtube.com/watch?v=abc_DEF-123', 'youtube', 'abc_DEF-123'],
            'short link' => ['https://youtu.be/dQw4w9WgXcQ?t=10', 'youtube', 'dQw4w9WgXcQ'],
            'shorts' => ['https://www.youtube.com/shorts/aBcDeFgHiJk', 'youtube', 'aBcDeFgHiJk'],
            'vimeo' => ['https://vimeo.com/76979871', 'vimeo', '76979871'],
            'vimeo unlisted' => ['https://vimeo.com/76979871/0a1b2c3d4e', 'vimeo', '76979871'],
        ];
    }

    #[DataProvider('videoUrls')]
    public function test_video_urls_store_their_provider_and_id(string $url, string $provider, string $id): void
    {
        // Whatever provider / id the client sends, the URL decides.
        [$element, $errors] = $this->element('video', ['url' => $url, 'provider' => 'vimeo', 'video_id' => 'nope', 'title' => 'Our story']);
        $this->assertSame([], $errors);
        $this->assertSame(['url' => $url, 'provider' => $provider, 'video_id' => $id, 'title' => 'Our story', 'aspect' => '16:9', 'autoplay' => false, 'start' => 0], $element['props']);
    }

    public function test_unsupported_videos_and_bad_video_props_are_refused(): void
    {
        foreach ([
            'https://www.youtube.com/embed/dQw4w9WgXcQ',
            'https://www.youtube.com/watch?v=abc',
            'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
            'https://vimeo.com/channels/staffpicks',
            'javascript:alert(1)//youtu.be/dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ"onerror="x',
            '',
            null,
        ] as $url) {
            $this->assertContains('props.url', $this->errorPaths('video', ['url' => $url, 'title' => 'Clip']), (string) $url);
        }
        $this->assertEqualsCanonicalizing(['props.title', 'props.aspect', 'props.autoplay', 'props.start'], $this->errorPaths('video', [
            'url' => 'https://youtu.be/dQw4w9WgXcQ', 'title' => '', 'aspect' => '21:9', 'autoplay' => 'yes', 'start' => -1,
        ]));
    }

    public function test_icons_countdowns_discounts_and_ctas_are_checked(): void
    {
        $this->assertEqualsCanonicalizing(['props.name', 'props.size', 'props.color', 'props.link.url'], $this->errorPaths('icon', [
            'name' => 'skull', 'size' => 8, 'color' => 'red', 'link' => ['url' => 'javascript:alert(1)'],
        ]));
        [$icon] = $this->element('icon', ['name' => 'map-pin', 'size' => 128, 'color' => '#AABBCC', 'label' => null], 'footer');
        $this->assertSame(['name' => 'map-pin', 'size' => 128, 'color' => '#aabbcc', 'label' => '', 'link' => null], $icon['props']);

        // Countdown: the date source needs a date, the promotion source a promotion; the other is cleared.
        $this->assertSame(['props.ends_at'], $this->errorPaths('countdown', ['source' => 'date', 'ends_at' => '31/12/2026']));
        $this->assertSame(['props.promotion_id'], $this->errorPaths('countdown', ['source' => 'promotion', 'ends_at' => '2026-12-31T00:00:00+06:00']));
        $this->assertSame(['props.source'], $this->errorPaths('countdown', ['source' => 'forever', 'ends_at' => '2026-12-31T00:00:00+06:00']));
        [$date] = $this->element('countdown', ['source' => 'date', 'ends_at' => '2026-12-31T00:00:00+06:00', 'promotion_id' => '01a1c9d9-0000-7000-8000-000000000201']);
        $this->assertSame(['2026-12-31T00:00:00+06:00', null], [$date['props']['ends_at'], $date['props']['promotion_id']]);
        [$promotion] = $this->element('countdown', ['source' => 'promotion', 'ends_at' => '2026-12-31T00:00:00+06:00', 'promotion_id' => '01A1C9D9-0000-7000-8000-000000000201']);
        $this->assertSame([null, '01a1c9d9-0000-7000-8000-000000000201'], [$promotion['props']['ends_at'], $promotion['props']['promotion_id']]);

        $this->assertEqualsCanonicalizing(['props.promotion_id', 'props.show_code', 'props.text'], $this->errorPaths('discount', [
            'promotion_id' => 'ten-percent', 'show_code' => 1, 'text' => str_repeat('x', 401),
        ]));
        [$discount] = $this->element('discount', ['promotion_id' => '01a1c9d9-0000-7000-8000-000000000202', 'link' => null]);
        $this->assertNull($discount['props']['link']);

        // CTA: the primary button is required, the secondary optional; their labels translate with dot keys.
        $this->assertEqualsCanonicalizing(['props.title', 'props.primary.label', 'props.primary.link', 'props.secondary', 'props.align'], $this->errorPaths('cta', [
            'title' => '', 'primary' => ['label' => '', 'link' => null], 'secondary' => 'Read more', 'align' => 'justify',
        ]));
        [$cta] = $this->element('cta', ['secondary' => ['label' => 'Our story', 'link' => ['url' => '/pages/about'], 'extra' => true]], 'zone', [
            'translations' => ['bn' => ['primary.label' => 'কিনুন', 'secondary.label' => 'আমাদের গল্প', 'primary' => 'x', 'unknown' => 'y']],
        ]);
        $this->assertSame(['label' => 'Our story', 'link' => ['url' => '/pages/about']], $cta['props']['secondary']);
        $this->assertSame(['bn' => ['primary.label' => 'কিনুন', 'secondary.label' => 'আমাদের গল্প']], $cta['translations']);
    }

    public function test_site_parts_and_content_elements_are_checked(): void
    {
        // Menus: sub-items per context.
        $menu = '01a1c9d9-0000-7000-8000-000000000101';
        $this->assertSame([], $this->errorPaths('menu', ['menu_id' => $menu, 'show_children' => 'mega'], 'header'));
        $this->assertSame(['props.show_children'], $this->errorPaths('menu', ['menu_id' => $menu, 'show_children' => 'mega'], 'footer'));
        $this->assertSame(['props.show_children'], $this->errorPaths('menu', ['menu_id' => $menu, 'show_children' => 'list'], 'header'));
        $this->assertSame(['props.menu_id'], $this->errorPaths('menu', ['menu_id' => null], 'header'));

        $this->assertEqualsCanonicalizing(['props.height', 'props.link'], $this->errorPaths('logo', ['height' => 200, 'link' => null], 'header'));
        $this->assertSame(['props.style'], $this->errorPaths('language_switch', ['style' => 'flags'], 'footer'));
        $this->assertEqualsCanonicalizing(['props.size', 'props.style'], $this->errorPaths('social_icons', ['size' => 64, 'style' => 'round'], 'footer'));
        $this->assertSame(['props.height'], $this->errorPaths('payment_icons', ['height' => 12], 'footer'));
        $this->assertSame(['props.show_email'], $this->errorPaths('contact_block', ['show_email' => 'no']));
        $this->assertSame(['props.button_label'], $this->errorPaths('newsletter_form', ['button_label' => ' ']));
        $this->assertSame(['props.style'], $this->errorPaths('faq_list', ['style' => 'tabs'], 'cms'));
        $this->assertSame(['props.product_id'], $this->errorPaths('promo_card', ['product_id' => null]));
        $this->assertSame(['props.badge'], $this->errorPaths('promo_card', ['product_id' => '01a1c9d9-0000-7000-8000-000000000301', 'badge' => str_repeat('b', 25)]));
        $this->assertSame(['props.html'], $this->errorPaths('custom_html', ['html' => '']));
        $this->assertSame(['props.html'], $this->errorPaths('custom_html', ['html' => str_repeat('a', ElementRegistry::CUSTOM_HTML_MAX + 1)]));

        // Optional texts: blank titles mean "use the default" (null), other blanks stay ''.
        [$card] = $this->element('promo_card', ['product_id' => '01a1c9d9-0000-7000-8000-000000000301', 'title' => '  ', 'text' => null]);
        $this->assertSame([null, ''], [$card['props']['title'], $card['props']['text']]);
        [$copyright] = $this->element('copyright', ['text' => ''], 'footer');
        $this->assertNull($copyright['props']['text']);
        [$faq] = $this->element('faq_list', ['title' => 'Questions', 'extra' => 1], 'cms', ['translations' => ['bn' => ['title' => 'প্রশ্ন', 'style' => 'list']]]);
        $this->assertSame(['title' => 'Questions', 'style' => 'accordion'], $faq['props']);
        $this->assertSame(['bn' => ['title' => 'প্রশ্ন']], $faq['translations']);
    }
}
