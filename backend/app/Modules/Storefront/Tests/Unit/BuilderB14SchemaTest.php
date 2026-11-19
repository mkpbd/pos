<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\Builder\B14ElementProps;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use PHPUnit\Framework\TestCase;

/**
 * B14: store page template contexts (`template:<key>` strict, plain `template` for any), the
 * five elements' props (defaults, limits, idempotent) and the page fields per template.
 */
class BuilderB14SchemaTest extends TestCase
{
    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private static function document(array $elements): array
    {
        return ['schema_version' => 1, 'sections' => [['id' => 's_a', 'type' => 'section', 'columns' => [['id' => 'c_a', 'width' => ['base' => 100], 'elements' => $elements]]]]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function errors(array $document, string $context): array
    {
        try {
            BuilderDocumentSchema::normalize($document, $context);
        } catch (InvalidBuilderDocument $e) {
            return $e->errors;
        }

        return [];
    }

    public function test_template_keys_map_to_their_own_context(): void
    {
        $this->assertSame('template:shop', BuilderDocumentSchema::contextOf('template:shop'));
        $this->assertSame('page', BuilderDocumentSchema::contextOf('template:checkout'));
        $this->assertSame(['template', 'blog_post'], BuilderDocumentSchema::splitContext('template:blog_post'));
        $this->assertSame('template', BuilderDocumentSchema::baseContext('template:order'));
        $this->assertContains('template', ElementRegistry::CONTEXTS);

        $this->expectException(\InvalidArgumentException::class);
        BuilderDocumentSchema::normalize(BuilderDocumentSchema::blank(), 'template:checkout');
    }

    public function test_the_elements_normalize_with_defaults_and_stay_the_same(): void
    {
        $document = self::document([
            ['id' => 'e_text', 'type' => 'dynamic_text', 'props' => ['field' => 'post.title', 'tag' => 'h1']],
            ['id' => 'e_body', 'type' => 'blog_post_body', 'props' => ['show_share' => false, 'extra' => 1]],
        ]);
        $once = BuilderDocumentSchema::normalize($document, 'template:blog_post');
        $this->assertSame($once, BuilderDocumentSchema::normalize($once, 'template:blog_post'));
        $elements = $once['sections'][0]['columns'][0]['elements'];
        $this->assertSame(['field' => 'post.title', 'tag' => 'h1', 'prefix' => '', 'suffix' => '', 'fallback' => '', 'format' => 'default'], $elements[0]['props']);
        $this->assertSame(['show_cover' => true, 'show_meta' => true, 'show_share' => false, 'show_related' => true], $elements[1]['props']);

        $listing = BuilderDocumentSchema::normalize(self::document([['id' => 'e_list', 'type' => 'product_listing']]), 'page')['sections'][0]['columns'][0]['elements'][0]['props'];
        $this->assertSame(ElementRegistry::defaults('product_listing'), $listing);
        $notFound = BuilderDocumentSchema::normalize(self::document([['id' => 'e_nf', 'type' => 'not_found_message']]), 'template:not_found')['sections'][0]['columns'][0]['elements'][0]['props'];
        $this->assertSame(['heading' => '', 'text' => '', 'show_search' => true, 'show_links' => true], $notFound);
    }

    public function test_limits_fields_and_places_are_checked(): void
    {
        $errors = self::errors(self::document([
            ['id' => 'e_a', 'type' => 'dynamic_text', 'props' => ['field' => 'nope', 'tag' => 'h4', 'prefix' => str_repeat('x', 81), 'format' => 'percent']],
            ['id' => 'e_b', 'type' => 'not_found_message', 'props' => ['heading' => str_repeat('x', 121), 'show_links' => 'yes']],
        ]), 'template:not_found');
        $this->assertSame(['props.field', 'props.tag', 'props.prefix', 'props.format', 'props.heading', 'props.show_links'], array_map(fn (array $e) => preg_replace('/^.*elements\.\d+\./', '', $e['path']), $errors));

        // Page fields: store.* everywhere; the template's own only in that template.
        $this->assertSame([], self::errors(self::document([['id' => 'e_a', 'type' => 'dynamic_text', 'props' => ['field' => 'store.email']]]), 'header'));
        $this->assertSame('FIELD_NOT_AVAILABLE', self::errors(self::document([['id' => 'e_a', 'type' => 'dynamic_text', 'props' => ['field' => 'order.total']]]), 'page')[0]['code']);
        $this->assertSame('FIELD_NOT_AVAILABLE', self::errors(self::document([['id' => 'e_a', 'type' => 'dynamic_text', 'props' => ['field' => 'order.total']]]), 'template:search')[0]['code']);
        $this->assertContains('order.total', B14ElementProps::fields('template', null));
        $this->assertSame(['category.name', 'category.description', 'category.product_count', ...ElementRegistry::STORE_FIELDS], B14ElementProps::fields('template', 'category'));

        // Main parts: only in their template (the listing also on pages); plain `template` takes any.
        foreach (['blog_post_body', 'order_summary', 'not_found_message'] as $type) {
            $this->assertSame('ELEMENT_NOT_ALLOWED', self::errors(self::document([['id' => 'e_x', 'type' => $type]]), 'page')[0]['code'], $type);
            $this->assertSame('ELEMENT_NOT_ALLOWED', self::errors(self::document([['id' => 'e_x', 'type' => $type]]), 'template:shop')[0]['code'], $type);
            $this->assertSame([], self::errors(self::document([['id' => 'e_x', 'type' => $type]]), 'template'), $type);
        }
        $this->assertSame('ELEMENT_NOT_ALLOWED', self::errors(self::document([['id' => 'e_x', 'type' => 'product_listing', 'props' => ['scope' => 'current']]]), 'template:order')[0]['code']);
        $this->assertSame('ELEMENT_NOT_ALLOWED', self::errors(self::document([['id' => 'e_x', 'type' => 'product_listing']]), 'zone')[0]['code']);
        $this->assertSame([], self::errors(self::document([['id' => 'e_x', 'type' => 'product_listing', 'props' => ['scope' => 'on_sale']]]), 'template'));
        $this->assertSame([], self::errors(self::document([['id' => 'e_x', 'type' => 'product_listing', 'props' => ['scope' => 'brands', 'brand_ids' => ['0199a5c1-0000-7000-8000-00000000aa01']]]]), 'cms'));
        $this->assertNotSame([], self::errors(self::document([['id' => 'e_x', 'type' => 'product_listing', 'props' => ['scope' => 'brands', 'brand_ids' => array_fill(0, 21, '0199a5c1-0000-7000-8000-00000000aa01')]]]), 'cms'));
    }

    public function test_main_parts_are_found_with_their_hidden_state(): void
    {
        $document = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => [[
            'id' => 's_a', 'type' => 'section', 'hidden' => true, 'columns' => [['id' => 'c_a', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_row', 'type' => 'inner_row', 'columns' => [['id' => 'c_in', 'width' => ['base' => 100], 'elements' => [['id' => 'e_order', 'type' => 'order_summary']]]]],
            ]]],
        ]]], 'template:order');
        $this->assertSame([['id' => 'e_order', 'path' => 'sections.0.columns.0.elements.0.columns.0.elements.0', 'hidden' => true]], BuilderDocumentSchema::coreElements($document, 'order'));
        $this->assertSame([], BuilderDocumentSchema::coreElements($document, 'shop'));
    }
}
