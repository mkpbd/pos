<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Application\Builder\Wizard\WizardCopy;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardMotion;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardOptions;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardRecipes;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use Tests\TestCase;

/**
 * B21: the wizard's recipes use shipped template sections, never repeat a slot and drop what
 * the store lacks; the built-in texts exist in English and Bangla for every slot and name no
 * prices or numbers; the look's motion passes the schema.
 */
class BuilderWizardRecipesTest extends TestCase
{
    public function test_every_slot_is_a_section_of_a_shipped_template_usable_on_pages(): void
    {
        $library = app(BuilderTemplateLibrary::class);
        foreach (WizardRecipes::SLOTS as $slot => $spec) {
            foreach ($slot === 'hero_festival' ? array_keys(FestivalCalendar::OCCASIONS) : [null] as $festival) {
                $id = WizardRecipes::template($slot, $festival);
                $template = $library->find($id);
                $this->assertNotNull($template, $id);
                $this->assertContains('page', $template['allowed_in'], $id);
                $this->assertIsArray($library->sections($id, 'page')[$spec['section']] ?? null, "{$id} section {$spec['section']}");
                $this->assertNotSame('', $spec['label']);
                $this->assertNotSame('', $spec['label_bn']);
            }
        }
    }

    public function test_recipes_follow_the_page_type_and_goal(): void
    {
        $all = ['categories' => true, 'flash_sale' => true, 'coupon' => true, 'reviews' => true];
        foreach (WizardOptions::PAGE_TYPES as $pageType) {
            foreach (WizardOptions::GOALS as $goal) {
                $slots = WizardRecipes::slots($pageType, $goal, $all);
                $this->assertSame($slots, array_values(array_unique($slots)), "{$pageType} × {$goal}");
                $this->assertStringStartsWith('hero', $slots[0]);
                $this->assertGreaterThanOrEqual(3, count($slots));
            }
        }
        $this->assertSame(['hero', 'categories', 'products', 'trust', 'cta', 'why_us', 'reviews'], WizardRecipes::slots('home', 'orders', $all));
        // No published reviews: no review wall (and never sample testimonials).
        $this->assertSame(['hero', 'products', 'trust', 'cta', 'why_us'], WizardRecipes::slots('home', 'orders'));
        $this->assertSame('neutral-review-wall', WizardRecipes::template('reviews'));
        $this->assertNotContains('neutral-testimonials', WizardRecipes::templates(array_keys(FestivalCalendar::OCCASIONS)));
        $this->assertSame(['hero_sale', 'flash_sale', 'coupon', 'products', 'trust', 'cta', 'faq'], WizardRecipes::slots('sale', 'orders', $all));
        $this->assertSame(['hero_sale', 'products', 'trust', 'cta', 'faq'], WizardRecipes::slots('sale', 'orders'));
        $this->assertSame(['hero', 'spotlight', 'order_form', 'trust', 'why_us', 'faq'], WizardRecipes::slots('product_launch', 'order_form'));
        $this->assertSame(['hero', 'spotlight', 'order_form', 'trust', 'why_us', 'reviews', 'faq'], WizardRecipes::slots('product_launch', 'order_form', ['reviews' => true]));
        $this->assertSame(['hero_plain', 'contact_form', 'visit', 'phone_form', 'trust', 'faq'], WizardRecipes::slots('contact', 'phone_numbers'));

        $this->assertFalse(WizardRecipes::needsProducts(WizardRecipes::slots('about', 'tell_story')));
        $this->assertFalse(WizardRecipes::needsProducts(WizardRecipes::slots('contact', 'phone_numbers')));
        $this->assertTrue(WizardRecipes::needsProducts(WizardRecipes::slots('about', 'orders')));
        $this->assertTrue(WizardRecipes::needsProducts(WizardRecipes::slots('festival', 'tell_story')));
        foreach (WizardOptions::DEFAULT_GOALS as $pageType => $goal) {
            $this->assertContains($pageType, WizardOptions::PAGE_TYPES);
            $this->assertContains($goal, WizardOptions::GOALS);
        }
    }

    public function test_the_built_in_texts_exist_in_english_and_bangla_without_prices(): void
    {
        $copy = json_decode((string) file_get_contents(WizardCopy::path()), true, flags: JSON_THROW_ON_ERROR);
        $entries = $copy['slots'];
        foreach ($copy['pages'] as $pageType => $slots) {
            $this->assertContains($pageType, WizardOptions::PAGE_TYPES);
            foreach ($slots as $slot => $entry) {
                $entries["{$pageType}.{$slot}"] = $entry;
            }
        }
        foreach ($entries as $key => $entry) {
            $slot = explode(':', str_contains($key, '.') ? explode('.', $key)[1] : $key)[0];
            $this->assertArrayHasKey($slot, WizardRecipes::SLOTS, $key);
            $this->assertNotSame([], $entry['en'], $key);
            $this->assertCount(count($entry['en']), $entry['bn'], $key);
            foreach ($entry['en'] as $i => $variant) {
                $this->assertSame(array_keys($variant), array_keys($entry['bn'][$i]), $key);
                foreach ([...array_values($variant), ...array_values($entry['bn'][$i])] as $text) {
                    $this->assertDoesNotMatchRegularExpression('/[0-9০-৯%৳]|\bTk\b|taka|টাকা/u', $text, $key);
                }
            }
        }

        $texts = app(WizardCopy::class)->texts('home', 'hero', null, ['store' => 'Berry', 'title' => 'Home', 'category' => null]);
        $this->assertSame(['heading', 'text', 'button', 'button_link'], array_keys($texts));
        $this->assertContains($texts['heading']['en'], ['Welcome to Berry', 'Berry — shop online']);
        // The same title gives the same variant.
        $this->assertSame($texts, app(WizardCopy::class)->texts('home', 'hero', null, ['store' => 'Berry', 'title' => 'Home', 'category' => null]));
        $this->assertSame('Our products', app(WizardCopy::class)->texts('home', 'products', 'category', ['store' => 'Berry', 'title' => 'x', 'category' => null])['title']['en']);
        $this->assertSame([], app(WizardCopy::class)->texts('home', 'trust', null, ['store' => 'Berry', 'title' => 'x', 'category' => null]));
    }

    public function test_each_look_passes_the_schema_and_keeps_the_page_top_still(): void
    {
        $content = ['schema_version' => 1, 'sections' => [
            ['id' => 's_top', 'type' => 'section', 'props' => ['shape_bottom' => ['shape' => 'wave', 'color' => 'theme:surface']], 'columns' => [['id' => 'c_top', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_h1', 'type' => 'heading', 'props' => ['text' => 'Hello', 'level' => 1]],
                ['id' => 'e_btn', 'type' => 'button', 'props' => ['label' => 'Shop', 'link' => ['url' => '/shop']]],
            ]]]],
            ['id' => 's_two', 'type' => 'section', 'columns' => [['id' => 'c_two', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_h2', 'type' => 'heading', 'props' => ['text' => 'More', 'level' => 2]],
                ['id' => 'e_own', 'type' => 'text', 'props' => ['html' => '<p>Mine</p>'], 'style' => ['base' => ['motion' => ['entrance' => 'flip-up', 'duration' => 500]]]],
            ]]]],
        ]];
        foreach (['calm', 'lively', 'festive'] as $look) {
            $applied = WizardMotion::apply($content, $look);
            try {
                $normalized = BuilderDocumentSchema::normalize($applied, 'page');
            } catch (InvalidBuilderDocument $e) {
                $this->fail("{$look}: ".json_encode($e->errors));
            }
            $this->assertSame($look, $normalized['motion_theme']);
            $top = $normalized['sections'][0];
            $this->assertSame('none', $top['style']['base']['motion']['entrance'] ?? 'none', $look);
            $this->assertArrayNotHasKey('scroll', $top['style']['base'], $look);
            $this->assertArrayNotHasKey('motion', $applied['sections'][0]['columns'][0]['elements'][0]['style']['base'] ?? [], $look);
            // The template's own motion is kept.
            $this->assertSame('flip-up', $applied['sections'][1]['columns'][0]['elements'][1]['style']['base']['motion']['entrance']);
        }
        $this->assertSame($content, WizardMotion::apply($content, 'current'));
        // The first section has no picture: its heading is the page's largest paint, left still.
        $this->assertArrayNotHasKey('text_effect', WizardMotion::apply($content, 'lively')['sections'][0]['columns'][0]['elements'][0]['props']);
        $this->assertArrayNotHasKey('text_effect', WizardMotion::apply($content, 'lively')['sections'][1]['columns'][0]['elements'][0]['props']);
        $this->assertSame('slide-up', WizardMotion::apply($content, 'lively')['sections'][1]['columns'][0]['elements'][0]['style']['base']['motion']['entrance']);
        $this->assertSame('flow', WizardMotion::apply($content, 'festive')['sections'][0]['props']['shape_bottom']['animate']);
        $this->assertSame('shine', WizardMotion::apply($content, 'festive')['sections'][0]['columns'][0]['elements'][1]['style']['base']['motion']['loop']);
    }
}
