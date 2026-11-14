<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Storefront\Domain\SectionType;
use Tests\TestCase;

/**
 * B1: the builder document schema — kept in sync with the storefront through the shared
 * fixture (frontend/src/storefront/builder/__fixtures__/sample-document.v1.json).
 */
class BuilderDocumentSchemaTest extends TestCase
{
    /**
     * @return array<string, mixed>
     */
    private function fixture(): array
    {
        $path = base_path('../frontend/src/storefront/builder/__fixtures__/sample-document.v1.json');
        $this->assertFileExists($path);

        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * Maps sorted by key at every level (lists keep their order), so comparisons ignore key order.
     */
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
     * @param  array<string, mixed>  $document
     * @return list<array{path: string, node_id: ?string, message: string}>
     */
    private function errorsOf(array $document): array
    {
        try {
            BuilderDocumentSchema::normalize($document);
        } catch (InvalidBuilderDocument $e) {
            $this->assertSame('DOCUMENT_INVALID', $e->errorCode);

            return $e->errors;
        }
        $this->fail('The document was accepted.');
    }

    /**
     * @param  array<string, mixed>  $element
     * @return array<string, mixed>
     */
    private function withElement(array $element, ?array $columnWidth = null): array
    {
        return ['schema_version' => 1, 'sections' => [[
            'id' => 's_one', 'type' => 'section',
            'columns' => [['id' => 'c_one', 'width' => $columnWidth ?? ['base' => 100], 'elements' => [$element]]],
        ]]];
    }

    public function test_the_shared_fixture_is_already_normalized(): void
    {
        $fixture = $this->fixture();
        $normalized = BuilderDocumentSchema::normalize($fixture);

        $this->assertSame($this->canonical($fixture), $this->canonical($normalized));
        $this->assertSame($this->canonical($normalized), $this->canonical(BuilderDocumentSchema::normalize($normalized)));

        // Every element type of the fixture exists in the registry; its JSON round-trip keeps objects.
        $types = [];
        BuilderDocumentSchema::walk($normalized, function (array $node, string $path, string $kind) use (&$types) {
            if ($kind === 'element') {
                $types[] = $node['type'];
            }
        });
        $this->assertSame([], array_diff($types, ElementRegistry::types()));
        $json = json_encode(BuilderJson::present($normalized));
        $this->assertStringContainsString('"translations":{}', (string) $json);
        $this->assertStringNotContainsString('"style":[]', (string) $json);
        $this->assertSame($this->canonical($fixture), $this->canonical(json_decode((string) $json, true)));
    }

    public function test_normalize_fills_defaults_drops_unknown_keys_and_is_idempotent(): void
    {
        $document = $this->withElement([
            'id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Hello', 'extra' => 1],
            'style' => ['base' => ['color' => '#AABBCC', 'unknown' => ['x' => 1], 'typography' => ['size' => '20px', 'font' => 'comic-sans']], 'print' => ['color' => '#000000']],
            'translations' => ['bn' => ['text' => 'হ্যালো', 'level' => 'x'], 'fr' => ['text' => 'Bonjour']],
            'mystery' => true,
        ]);
        $normalized = BuilderDocumentSchema::normalize($document);
        $element = $normalized['sections'][0]['columns'][0]['elements'][0];

        $this->assertSame(['text' => 'Hello', 'level' => 2, 'link' => null], $element['props']);
        $this->assertSame(['base' => ['color' => '#aabbcc', 'typography' => ['size' => '20px']]], $element['style']);
        $this->assertSame(['bn' => ['text' => 'হ্যালো']], $element['translations']);
        $this->assertSame(['desktop' => true, 'tablet' => true, 'mobile' => true], $element['visibility']);
        $this->assertFalse($element['hidden']);
        $this->assertNull($element['schedule']);
        $this->assertArrayNotHasKey('mystery', $element);
        $this->assertSame(['layout' => 'boxed', 'anchor' => null], $normalized['sections'][0]['props']);
        $this->assertSame('column', $normalized['sections'][0]['columns'][0]['type']);
        $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized));

        // Wrapped sections: config through SectionType::normalize, items cleared for non-manual sources.
        $grid = BuilderDocumentSchema::normalize($this->withElement(['id' => 'e_grid', 'type' => 'product_grid', 'props' => [
            'config' => ['source' => 'featured', 'limit' => 12, 'junk' => true],
            'items' => [['item_type' => 'product', 'item_id' => '01A1C9D9-0000-7000-8000-000000000009']],
        ]]))['sections'][0]['columns'][0]['elements'][0]['props'];
        $this->assertSame(['title' => null, 'subtitle' => null, 'config' => SectionType::ProductGrid->normalize(['source' => 'featured', 'limit' => 12]), 'items' => []], $grid);
    }

    public function test_style_values_are_whitelisted_and_bounded(): void
    {
        $style = StyleSchema::normalize(['base' => [
            'color' => 'red',
            'background' => ['type' => 'gradient', 'gradient' => ['type' => 'linear', 'angle' => 90, 'stops' => [['color' => 'theme:primary', 'position' => 0]]]],
            'spacing' => ['margin' => ['top' => 'auto', 'left' => '-20px'], 'padding' => ['top' => '-4px', 'right' => 'auto', 'bottom' => '12rem', 'left' => '2001px', 'center' => '1px']],
            'size' => ['width' => '101%', 'height' => '120vh', 'max_width' => '1200px', 'min_height' => 'calc(100% - 1px)'],
            'typography' => ['weight' => 450, 'line_height' => 5, 'letter_spacing' => '-0.05em', 'size' => '1.5rem'],
            'border' => ['width' => '21px', 'style' => 'groove', 'color' => 'theme:nope', 'radius' => ['tl' => '8px', 'tr' => '-1px']],
            'effects' => ['opacity' => 1.5, 'shadow' => [
                ['x' => 0, 'y' => 1, 'blur' => 2, 'color' => '#000000'],
                ['x' => 0, 'y' => 1, 'blur' => 300, 'color' => '#000000'],
                ['x' => 1, 'y' => 1, 'blur' => 1, 'color' => '#000000'],
                ['x' => 2, 'y' => 2, 'blur' => 2, 'color' => '#000000'],
                ['x' => 3, 'y' => 3, 'blur' => 3, 'color' => '#000000'],
            ], 'hover' => ['transform' => 'spin', 'color' => '#fff']],
            'layout' => ['gap' => '-8px', 'wrap' => 'yes'],
        ], 'tablet' => ['color' => '</style><script>'], 'mobile' => ['background' => ['type' => 'image', 'image' => ['media_id' => 'javascript:alert(1)']]]]);

        $this->assertSame($this->canonical(['base' => [
            'background' => ['type' => 'gradient'],
            'spacing' => ['margin' => ['top' => 'auto', 'left' => '-20px'], 'padding' => ['bottom' => '12rem']],
            'size' => ['max_width' => '1200px'],
            'typography' => ['letter_spacing' => '-0.05em', 'size' => '1.5rem'],
            'border' => ['radius' => ['tl' => '8px']],
            'effects' => ['shadow' => [
                ['x' => 0, 'y' => 1, 'blur' => 2, 'color' => '#000000'],
                ['x' => 1, 'y' => 1, 'blur' => 1, 'color' => '#000000'],
                ['x' => 2, 'y' => 2, 'blur' => 2, 'color' => '#000000'],
            ]],
        ], 'mobile' => ['background' => ['type' => 'image']]]), $this->canonical($style));
    }

    public function test_empty_groups_are_dropped_but_an_explicit_empty_shadow_list_is_kept(): void
    {
        $this->assertSame([], StyleSchema::normalize(['base' => ['typography' => ['font' => 'comic-sans']], 'tablet' => [], 'mobile' => ['spacing' => ['padding' => []]]]));
        $this->assertSame(
            ['base' => ['color' => '#ffffff'], 'mobile' => ['effects' => ['shadow' => [], 'hover' => ['shadow' => []]]]],
            StyleSchema::normalize([
                'base' => ['color' => '#FFFFFF', 'effects' => ['shadow' => [['x' => 500, 'y' => 0, 'blur' => 0, 'color' => '#000000']], 'text_shadow' => [['color' => 'nope']]]],
                'mobile' => ['effects' => ['shadow' => [], 'hover' => ['shadow' => []]]],
            ]),
        );
    }

    public function test_invalid_documents_list_every_problem_with_its_path_and_node(): void
    {
        $errors = $this->errorsOf(['schema_version' => 1, 'sections' => [
            ['id' => 's_a', 'type' => 'section', 'props' => ['layout' => 'wide', 'anchor' => 'Bad Anchor'], 'columns' => [
                ['id' => 'c_a', 'width' => ['base' => 3], 'elements' => [
                    ['id' => 'e_btn', 'type' => 'button', 'props' => ['label' => 'Go', 'link' => ['url' => 'javascript:alert(1)']]],
                    ['id' => 'e_btn', 'type' => 'heading', 'props' => ['text' => '', 'level' => 7]],
                    ['id' => 'e_row', 'type' => 'inner_row', 'columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'elements' => [
                        ['id' => 'e_nested', 'type' => 'inner_row', 'columns' => []],
                    ]]]],
                    ['id' => 'e_div', 'type' => 'divider', 'props' => ['color' => 'blue', 'thickness' => 11]],
                    ['id' => 'e_what', 'type' => 'fireworks'],
                    ['id' => 'Bad Id', 'type' => 'spacer'],
                    ['id' => 'e_sched', 'type' => 'spacer', 'schedule' => ['starts_at' => '2026-12-02T00:00:00Z', 'ends_at' => '2026-12-01T00:00:00Z']],
                    ['id' => 'e_img', 'type' => 'image', 'props' => ['media_id' => 'not-a-uuid']],
                ]],
            ]],
            ['id' => 's_b', 'type' => 'section', 'columns' => []],
        ]]);

        $byPath = array_column($errors, null, 'path');
        $this->assertSame('s_a', $byPath['sections.0.props.layout']['node_id']);
        $this->assertArrayHasKey('sections.0.props.anchor', $byPath);
        $this->assertSame('c_a', $byPath['sections.0.columns.0.width.base']['node_id']);
        $this->assertSame('e_btn', $byPath['sections.0.columns.0.elements.0.props.link.url']['node_id']);
        $this->assertStringContainsString('used more than once', $byPath['sections.0.columns.0.elements.1.id']['message']);
        $this->assertArrayHasKey('sections.0.columns.0.elements.1.props.text', $byPath);
        $this->assertArrayHasKey('sections.0.columns.0.elements.1.props.level', $byPath);
        $this->assertSame('e_nested', $byPath['sections.0.columns.0.elements.2.columns.0.elements.0.type']['node_id']);
        $this->assertArrayHasKey('sections.0.columns.0.elements.3.props.color', $byPath);
        $this->assertArrayHasKey('sections.0.columns.0.elements.3.props.thickness', $byPath);
        $this->assertArrayHasKey('sections.0.columns.0.elements.4.type', $byPath);
        $this->assertArrayHasKey('sections.0.columns.0.elements.5.id', $byPath);
        $this->assertSame('e_sched', $byPath['sections.0.columns.0.elements.6.schedule.ends_at']['node_id']);
        $this->assertArrayHasKey('sections.0.columns.0.elements.7.props.media_id', $byPath);
        $this->assertSame('s_b', $byPath['sections.1.columns']['node_id']);

        // Wrapped sections use the homepage section rules and limits.
        $errors = $this->errorsOf($this->withElement(['id' => 'e_feat', 'type' => 'features_strip', 'props' => ['config' => ['items' => [['icon' => 'skull', 'title' => 'X']]]]]));
        $this->assertSame('sections.0.columns.0.elements.0.props.config.items.0.icon', $errors[0]['path']);
        $errors = $this->errorsOf($this->withElement(['id' => 'e_text', 'type' => 'rich_text', 'props' => []]));
        $this->assertSame('sections.0.columns.0.elements.0.props.config', $errors[0]['path']);
        $errors = $this->errorsOf($this->withElement(['id' => 'e_grid', 'type' => 'banner_grid', 'props' => ['config' => ['layout' => '3-col-split'], 'items' => [
            ['item_type' => 'banner', 'item_id' => '01a1c9d9-0000-7000-8000-000000000001'],
            ['item_type' => 'banner', 'item_id' => '01a1c9d9-0000-7000-8000-000000000002'],
        ]]]));
        $this->assertSame('This element needs exactly 4 banners.', $errors[0]['message']);
        $errors = $this->errorsOf($this->withElement(['id' => 'e_news', 'type' => 'newsletter', 'props' => ['config' => ['background' => 'red'], 'items' => [['item_type' => 'banner', 'item_id' => '01a1c9d9-0000-7000-8000-000000000001']]]]));
        $this->assertEqualsCanonicalizing(['sections.0.columns.0.elements.0.props.config.background', 'sections.0.columns.0.elements.0.props.items'], array_column($errors, 'path'));
        $errors = $this->errorsOf($this->withElement(['id' => 'e_grid', 'type' => 'product_grid', 'props' => ['config' => ['source' => 'manual', 'view_all_url' => 'javascript:alert(1)'], 'items' => []]]));
        $this->assertEqualsCanonicalizing(['sections.0.columns.0.elements.0.props.config.view_all_url', 'sections.0.columns.0.elements.0.props.items'], array_column($errors, 'path'));

        // Translations follow the field limits.
        $errors = $this->errorsOf($this->withElement(['id' => 'e_btn', 'type' => 'button', 'translations' => ['bn' => ['label' => str_repeat('ক', 61)]]]));
        $this->assertSame('sections.0.columns.0.elements.0.translations.bn.label', $errors[0]['path']);
    }

    public function test_document_limits(): void
    {
        $this->assertSame('sections', $this->errorsOf(['schema_version' => 1, 'sections' => array_map(fn (int $i) => [
            'id' => "s_{$i}", 'type' => 'section', 'columns' => [['id' => "c_{$i}", 'width' => ['base' => 100], 'elements' => []]],
        ], range(1, 61))])[0]['path']);

        // 400 nodes: 50 sections × (1 section + 1 column + 7 elements) = 450.
        $errors = $this->errorsOf(['schema_version' => 1, 'sections' => array_map(fn (int $i) => [
            'id' => "s_{$i}", 'type' => 'section', 'columns' => [['id' => "c_{$i}", 'width' => ['base' => 100], 'elements' => array_map(fn (int $e) => ['id' => "e_{$i}_{$e}", 'type' => 'spacer'], range(1, 7))]],
        ], range(1, 50))]);
        $this->assertStringContainsString('at most 400', $errors[0]['message']);

        $errors = $this->errorsOf(['schema_version' => 1, 'sections' => [[
            'id' => 's_one', 'type' => 'section',
            'columns' => [['id' => 'c_one', 'width' => ['base' => 100], 'elements' => array_map(fn (int $e) => ['id' => "e_{$e}", 'type' => 'spacer'], range(1, 41))]],
        ]]]);
        $this->assertSame('sections.0.columns.0.elements', $errors[0]['path']);

        $errors = $this->errorsOf(['schema_version' => 1, 'sections' => [[
            'id' => 's_one', 'type' => 'section',
            'columns' => array_map(fn (int $c) => ['id' => "c_{$c}", 'width' => ['base' => 10], 'elements' => []], range(1, 7)),
        ]]]);
        $this->assertSame('sections.0.columns', $errors[0]['path']);

        $big = $this->withElement(['id' => 'e_text', 'type' => 'text', 'props' => ['html' => str_repeat('a', 270000)]]);
        $this->assertStringContainsString('too large', $this->errorsOf($big)[0]['message']);

        $this->assertSame('schema_version', $this->errorsOf(['schema_version' => 2, 'sections' => []])[0]['path']);
    }

    public function test_column_widths_round_to_two_decimals(): void
    {
        $document = BuilderDocumentSchema::normalize($this->withElement(['id' => 'e_s', 'type' => 'spacer'], ['base' => 33.3333, 'tablet' => 50.0, 'mobile' => null]));

        $this->assertSame(['base' => 33.33, 'tablet' => 50], $document['sections'][0]['columns'][0]['width']);
    }

    public function test_the_registry_describes_every_element_type(): void
    {
        $meta = ElementRegistry::metadata();
        $this->assertCount(7 + count(SectionType::cases()) + count(ElementRegistry::B4) + count(ElementRegistry::B6) + count(ElementRegistry::B8A) + count(ElementRegistry::B8B) + count(ElementRegistry::P2A), $meta['types']);
        $byType = array_column($meta['types'], null, 'type');
        $this->assertSame('columns', $byType['inner_row']['children']);
        $this->assertSame(['text'], $byType['heading']['translatable']);
        $this->assertSame(['title', 'subtitle', 'body_html'], $byType['rich_text']['translatable']);
        $this->assertSame('commerce', $byType['product_grid']['group']);
        $this->assertSame(400, $meta['limits']['nodes']);

        // Every element's defaults survive normalize unchanged (except wrapped types that need content).
        foreach (ElementRegistry::types() as $type) {
            $sectionType = ElementRegistry::sectionType($type);
            if ($sectionType !== null && ($sectionType->itemLimits() !== null || in_array($sectionType, [SectionType::RichText, SectionType::FeaturesStrip, SectionType::Testimonials, SectionType::BannerGrid, SectionType::ProductTabs], true))) {
                continue;
            }
            // B4: these start without the content they need (the editor's setup dialog).
            if (in_array($type, ['video', 'countdown', 'discount', 'promo_card', 'menu', 'custom_html',
                // B6: images, an address or a catalogue record first.
                'gallery', 'image_carousel', 'logo_carousel', 'map', 'category_card', 'product_spotlight', 'shop_the_look',
                // B8a: photos or products first.
                'before_after', 'bundle', 'photo_grid',
                // P2a: the product the order form sells.
                'order_form'], true)) {
                continue;
            }
            $element = ['id' => 'e_x', 'type' => $type, 'props' => ElementRegistry::defaults($type)] + ($type === 'inner_row' ? ['columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => []]]] : []);
            $props = BuilderDocumentSchema::normalize($this->withElement($element), ElementRegistry::allowedIn($type)[0])['sections'][0]['columns'][0]['elements'][0]['props'];
            $this->assertSame(ElementRegistry::defaults($type), $props, $type);
        }
    }
}
