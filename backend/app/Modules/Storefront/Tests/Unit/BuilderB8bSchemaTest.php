<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\PopupSettings;
use App\Modules\Storefront\Domain\Forms\FormAnswers;
use Tests\TestCase;

/**
 * B8b: the popup document context (settings, allowed elements, the dismiss button), the `form`
 * element (fields, options, limits, translations), the two cross-side fixtures and the answers a
 * visitor sends (FormAnswers).
 */
class BuilderB8bSchemaTest extends TestCase
{
    private const FIXTURES = '../frontend/src/storefront/builder/__fixtures__/';

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
     * @return array<string, mixed>
     */
    private function fixture(string $name): array
    {
        $path = base_path(self::FIXTURES.$name);
        $this->assertFileExists($path);

        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @param  array<string, mixed>|null  $popup
     * @return array<string, mixed>
     */
    private function document(array $elements, ?array $popup = null): array
    {
        return ['schema_version' => 1, ...($popup === null ? [] : ['popup' => $popup]), 'sections' => [[
            'id' => 's_x', 'type' => 'section',
            'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function errors(array $document, string $context): array
    {
        try {
            BuilderDocumentSchema::normalize($document, $context);
        } catch (InvalidBuilderDocument $e) {
            return $e->errors;
        }

        return [];
    }

    /**
     * @param  array<string, mixed>  $props
     * @return list<string> error paths relative to the element's props
     */
    private function formErrors(array $props): array
    {
        $errors = $this->errors($this->document([['id' => 'e_form', 'type' => 'form', 'props' => $props]]), 'page');

        return array_values(array_unique(array_map(fn (array $e) => (string) preg_replace('/^sections\.0\.columns\.0\.elements\.0\.props\.?/', '', $e['path']), $errors)));
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private static function field(string $id, string $kind, array $overrides = []): array
    {
        return $overrides + ['id' => $id, 'kind' => $kind, 'label' => ucfirst($kind)];
    }

    public function test_the_fixtures_round_trip_unchanged(): void
    {
        foreach (['sample-popup.v1.json' => 'popup', 'sample-b8b-form.v1.json' => 'page'] as $file => $context) {
            $fixture = $this->fixture($file);
            $normalized = BuilderDocumentSchema::normalize($fixture, $context);
            $this->assertSame($this->canonical($fixture), $this->canonical(json_decode((string) json_encode(BuilderJson::present($normalized)), true)), $file);
            $this->assertSame($normalized, BuilderDocumentSchema::normalize($normalized, $context), $file);
        }

        $popup = $this->fixture('sample-popup.v1.json');
        $this->assertSame(['schema_version', 'popup', 'sections'], array_keys($popup));
        $this->assertSame(array_keys(PopupSettings::defaults()), array_keys($popup['popup']));
        $json = json_encode($popup);
        $this->assertStringContainsString('"action":"dismiss"', $json);

        $form = $this->fixture('sample-b8b-form.v1.json');
        $kinds = [];
        BuilderDocumentSchema::walk($form, function (array $node, string $path, string $kind) use (&$kinds) {
            if ($kind === 'element' && $node['type'] === 'form') {
                array_push($kinds, ...array_column($node['props']['fields'], 'kind'));
            }
        });
        $this->assertEqualsCanonicalizing(ElementRegistry::FORM_FIELD_KINDS, array_values(array_unique($kinds)));
        $json = (string) json_encode($form, JSON_UNESCAPED_UNICODE);
        foreach (['"fields.f_size.options.o_m.label"', '"consent.text"', '"fields.f_name.placeholder"', '"notify_email":"owner@example.com"'] as $needle) {
            $this->assertStringContainsString($needle, $json);
        }
    }

    public function test_popup_settings_are_normalized_with_defaults_and_checked(): void
    {
        // A popup without settings gets the defaults; other documents never keep them.
        $blank = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => []], 'popup');
        $this->assertSame(PopupSettings::defaults(), $blank['popup']);
        $this->assertSame(BuilderDocumentSchema::blankPopup(), $blank);
        $page = BuilderDocumentSchema::normalize(['schema_version' => 1, 'popup' => PopupSettings::defaults(), 'sections' => []], 'page');
        $this->assertArrayNotHasKey('popup', $page);
        $this->assertSame('popup', BuilderDocumentSchema::contextOf('popup:0199a5c1-0000-7000-8000-00000000aa01'));

        // Unknown keys are dropped; every key is present.
        $settings = BuilderDocumentSchema::normalize(['schema_version' => 1, 'popup' => ['layout' => 'bar_top', 'extra' => 1, 'trigger' => ['kind' => 'on_scroll', 'scroll_percent' => 30]], 'sections' => []], 'popup')['popup'];
        $this->assertSame('bar_top', $settings['layout']);
        $this->assertSame(['kind' => 'on_scroll', 'delay_seconds' => 5, 'scroll_percent' => 30], $settings['trigger']);
        $this->assertArrayNotHasKey('extra', $settings);

        $cases = [
            'popup.layout' => ['layout' => 'sidebar'],
            'popup.position' => ['position' => 'top_left'],
            'popup.width' => ['width' => 'xl'],
            'popup.overlay' => ['overlay' => 'yes'],
            'popup.label' => ['label' => str_repeat('a', 121)],
            'popup.trigger.kind' => ['trigger' => ['kind' => 'on_click']],
            'popup.trigger.delay_seconds' => ['trigger' => ['kind' => 'on_load', 'delay_seconds' => 121]],
            'popup.trigger.scroll_percent' => ['trigger' => ['kind' => 'on_scroll', 'scroll_percent' => 95]],
            'popup.frequency.kind' => ['frequency' => ['kind' => 'hourly']],
            'popup.frequency.days' => ['frequency' => ['kind' => 'once_every_days', 'days' => 366]],
            'popup.pages.kind' => ['pages' => ['kind' => 'blog']],
            'popup.pages.paths' => ['pages' => ['kind' => 'paths', 'paths' => []]],
            'popup.pages.paths.0' => ['pages' => ['kind' => 'paths', 'paths' => ['p/no-slash']]],
            'popup.devices' => ['devices' => 'tv'],
            'popup.audience' => ['audience' => 'admins'],
            'popup.priority' => ['priority' => 101],
            'popup.starts_at' => ['starts_at' => 'tomorrow'],
            'popup.ends_at' => ['starts_at' => '2026-12-02T00:00:00+06:00', 'ends_at' => '2026-12-01T00:00:00+06:00'],
            'popup.translations.bn.label' => ['translations' => ['bn' => ['label' => str_repeat('ক', 121)]]],
            'popup' => 'modal',
        ];
        foreach ($cases as $path => $popup) {
            $errors = $this->errors(['schema_version' => 1, 'popup' => $popup, 'sections' => []], 'popup');
            $this->assertContains($path, array_column($errors, 'path'), $path);
        }
        $this->assertContains('popup.pages.paths', array_column($this->errors(['schema_version' => 1, 'popup' => ['pages' => ['kind' => 'paths', 'paths' => array_map(fn ($i) => "/p/page-{$i}", range(0, PopupSettings::MAX_PATHS))]], 'sections' => []], 'popup'), 'path'));

        // Never on checkout, cart, account or order pages.
        foreach (['/checkout', '/cart', '/account/orders', '/order/WEB-1', '/orders'] as $path) {
            $errors = $this->errors(['schema_version' => 1, 'popup' => ['pages' => ['kind' => 'paths', 'paths' => ['/shop', $path]]], 'sections' => []], 'popup');
            $this->assertSame([['path' => 'popup.pages.paths.1', 'node_id' => null, 'message' => 'Popups never show on the checkout, cart, account or order pages.', 'code' => 'POPUP_PAGE_FORBIDDEN']], $errors, $path);
        }
        $this->assertTrue(PopupSettings::forbiddenPath('/Checkout/step-2'));
        $this->assertFalse(PopupSettings::forbiddenPath('/p/cart-sale') || PopupSettings::forbiddenPath('/shop'));
    }

    public function test_popups_take_their_own_set_of_elements_and_buttons_may_dismiss_them(): void
    {
        foreach (ElementRegistry::types() as $type) {
            $this->assertSame(in_array($type, ElementRegistry::POPUP_ELEMENTS, true), in_array('popup', ElementRegistry::allowedIn($type), true), $type);
        }
        foreach (['product_grid', 'hero_slider', 'chart', 'map', 'menu', 'cart_icon', 'logo', 'gallery', 'faq_list', 'contact_form'] as $type) {
            $errors = $this->errors($this->document([['id' => 'e_x', 'type' => $type, 'props' => []]]), 'popup');
            $this->assertContains('ELEMENT_NOT_ALLOWED', array_column($errors, 'code'), $type);
            $this->assertStringContainsString('cannot be used in a popup', $errors[0]['message']);
        }
        $this->assertSame(['page', 'cms', 'zone', 'popup'], ElementRegistry::allowedIn('form'));
        $this->assertSame('content', ElementRegistry::group('form'));

        $button = fn (?string $action) => ['id' => 'e_b', 'type' => 'button', 'props' => ['label' => 'OK', 'link' => ['url' => '/']] + ($action === null ? [] : ['action' => $action])];
        $props = fn (array $doc, string $context) => BuilderDocumentSchema::normalize($doc, $context)['sections'][0]['columns'][0]['elements'][0]['props'];
        $this->assertSame('dismiss', $props($this->document([$button('dismiss')]), 'popup')['action']);
        // `link` is the default and is not stored, so older documents keep their shape.
        $this->assertArrayNotHasKey('action', $props($this->document([$button('link')]), 'popup'));
        $this->assertArrayNotHasKey('action', $props($this->document([$button(null)]), 'page'));
        $this->assertSame('sections.0.columns.0.elements.0.props.action', $this->errors($this->document([$button('dismiss')]), 'page')[0]['path']);
        $this->assertSame('sections.0.columns.0.elements.0.props.action', $this->errors($this->document([$button('close')]), 'popup')[0]['path']);

        // No sticky sections in a popup.
        $sticky = $this->document([$button(null)]);
        $sticky['sections'][0]['props'] = ['sticky' => true];
        $this->assertSame('sections.0.props.sticky', $this->errors($sticky, 'popup')[0]['path']);
    }

    public function test_the_form_element_is_normalized_and_checked(): void
    {
        $defaults = BuilderDocumentSchema::normalize($this->document([['id' => 'e_form', 'type' => 'form', 'props' => []]]), 'page')['sections'][0]['columns'][0]['elements'][0]['props'];
        $this->assertSame(ElementRegistry::defaults('form'), $defaults);

        // Values that don't apply to a field's kind are dropped silently.
        $form = BuilderDocumentSchema::normalize($this->document([['id' => 'e_form', 'type' => 'form', 'props' => ['fields' => [
            self::field('f_a', 'text', ['options' => [['id' => 'o1', 'label' => 'x']], 'min' => 1, 'max_length' => 50]),
            self::field('f_b', 'number', ['min' => 1.5, 'max' => 10, 'max_length' => 5]),
            self::field('f_c', 'radio', ['options' => [['id' => 'o1', 'label' => 'Yes'], ['id' => 'o2', 'label' => 'No']], 'min' => 3]),
        ], 'notify_email' => ' Owner@Example.com ']]]), 'page')['sections'][0]['columns'][0]['elements'][0]['props'];
        $this->assertSame([[], null, null, 50], [$form['fields'][0]['options'], $form['fields'][0]['min'], $form['fields'][0]['max'], $form['fields'][0]['max_length']]);
        $this->assertSame([1.5, 10, null], [$form['fields'][1]['min'], $form['fields'][1]['max'], $form['fields'][1]['max_length']]);
        $this->assertSame([null, 2], [$form['fields'][2]['min'], count($form['fields'][2]['options'])]);
        $this->assertSame('owner@example.com', $form['notify_email']);
        $this->assertSame(['id', 'kind', 'label', 'placeholder', 'help', 'required', 'options', 'min', 'max', 'max_length', 'reply_to'], array_keys($form['fields'][0]));

        $twentyOne = array_map(fn ($i) => self::field("f{$i}", 'text'), range(1, 21));
        $cases = [
            'fields' => ['fields' => []],
            'fields.0.kind' => ['fields' => [self::field('f_a', 'file')]],
            'fields.0.label' => ['fields' => [self::field('f_a', 'text', ['label' => ''])]],
            'fields.0.help' => ['fields' => [self::field('f_a', 'text', ['help' => str_repeat('a', 161)])]],
            'fields.0.options' => ['fields' => [self::field('f_a', 'select', ['options' => [['id' => 'o1', 'label' => 'Only one']]])]],
            'fields.0.options.1.id' => ['fields' => [self::field('f_a', 'checkboxes', ['options' => [['id' => 'o1', 'label' => 'A'], ['id' => 'o1', 'label' => 'B']]])]],
            'fields.0.options.0.label' => ['fields' => [self::field('f_a', 'select', ['options' => [['id' => 'o1', 'label' => str_repeat('a', 61)], ['id' => 'o2', 'label' => 'B']]])]],
            'fields.0.max' => ['fields' => [self::field('f_a', 'number', ['min' => 10, 'max' => 1])]],
            'fields.0.min' => ['fields' => [self::field('f_a', 'number', ['min' => 1.234])]],
            'fields.0.max_length' => ['fields' => [self::field('f_a', 'textarea', ['max_length' => 2001])]],
            'fields.0.reply_to' => ['fields' => [self::field('f_a', 'text', ['reply_to' => true])]],
            'fields.1.reply_to' => ['fields' => [self::field('f_a', 'email', ['reply_to' => true]), self::field('f_b', 'email', ['reply_to' => true])]],
            'fields.1.id' => ['fields' => [self::field('f_a', 'text'), self::field('f_a', 'email')]],
            'submit_label' => ['submit_label' => ''],
            'success_message' => ['success_message' => str_repeat('a', 301)],
            'consent' => ['consent' => 'yes'],
            'consent.text' => ['consent' => ['text' => '', 'link' => null]],
            'consent.link.url' => ['consent' => ['text' => 'I agree', 'link' => ['url' => 'javascript:alert(1)']]],
            'notify_email' => ['notify_email' => 'not-an-address'],
            'layout' => ['layout' => 'grid'],
            'title' => ['title' => str_repeat('a', 121)],
        ];
        foreach ($cases as $path => $props) {
            $this->assertContains($path, $this->formErrors($props), $path);
        }
        $this->assertContains('fields', $this->formErrors(['fields' => $twentyOne]));

        // Translations: texts, field texts and option labels (unknown keys dropped).
        $translated = BuilderDocumentSchema::normalize($this->document([['id' => 'e_form', 'type' => 'form', 'props' => [
            'fields' => [self::field('f_a', 'select', ['options' => [['id' => 'o1', 'label' => 'Red'], ['id' => 'o2', 'label' => 'Blue']]])],
            'consent' => ['text' => 'I agree', 'link' => null],
        ], 'translations' => ['bn' => [
            'title' => 'যোগাযোগ', 'consent.text' => 'আমি রাজি', 'fields.f_a.label' => 'রং',
            'fields.f_a.options.o2.label' => 'নীল', 'fields.f_zz.label' => 'x', 'fields.f_a.options.o9.label' => 'y',
        ]]]]), 'page')['sections'][0]['columns'][0]['elements'][0];
        $this->assertSame(['title' => 'যোগাযোগ', 'consent.text' => 'আমি রাজি', 'fields.f_a.label' => 'রং', 'fields.f_a.options.o2.label' => 'নীল'], $translated['translations']['bn']);
        $bn = BuilderPageRenderer::localizedProps('form', $translated['props'], $translated['translations'], 'bn');
        $this->assertSame(['যোগাযোগ', 'আমি রাজি', 'রং', 'Red', 'নীল'], [$bn['title'], $bn['consent']['text'], $bn['fields'][0]['label'], $bn['fields'][0]['options'][0]['label'], $bn['fields'][0]['options'][1]['label']]);

        $meta = ElementRegistry::metadata();
        $this->assertContains('fields.*.options.*.label', array_column($meta['types'], 'translatable', 'type')['form']);
        $this->assertSame(PopupSettings::LAYOUTS, $meta['enums']['popup_layouts']);
        $this->assertSame(ElementRegistry::FORM_FIELD_KINDS, $meta['enums']['form_field_kinds']);
        $this->assertSame(['min' => 1, 'max' => 20], $meta['limits']['lists']['form.fields']);
    }

    public function test_answers_are_checked_against_the_fields_and_stored_as_text(): void
    {
        $props = BuilderDocumentSchema::normalize($this->fixture('sample-b8b-form.v1.json'), 'page')['sections'][0]['columns'][0]['elements'][0]['props'];
        $ok = FormAnswers::check($props, [
            'f_name' => '  Rahima Akter ',
            'f_email' => 'Rahima@Example.com',
            'f_phone' => '+880 1711-000000',
            'f_people' => '02.50',
            'f_size' => 'o_m',
            'f_time' => 'o_pm',
            'f_gift' => true,
            'f_extras' => ['o_card', 'o_wrap'],
            'f_date' => '2026-12-24',
        ], true);
        $this->assertSame([], $ok['errors']);
        $this->assertSame([
            'f_name' => 'Rahima Akter', 'f_email' => 'rahima@example.com', 'f_phone' => '+880 1711-000000', 'f_notes' => null,
            'f_people' => '2.5', 'f_size' => 'Medium', 'f_time' => 'Afternoon', 'f_gift' => true, 'f_extras' => ['Gift wrap', 'Card'], 'f_date' => '2026-12-24',
        ], $ok['values']);
        $this->assertSame('rahima@example.com', $ok['reply_to']);
        $this->assertSame(['id' => 'f_name', 'label' => 'Your name', 'kind' => 'text'], $ok['fields'][0]);
        $this->assertSame('Your name: Rahima Akter · E-mail: rahima@example.com', FormAnswers::summary($ok['fields'], $ok['values']));
        $this->assertSame(['Yes', 'Gift wrap, Card', '—'], [FormAnswers::text(true), FormAnswers::text(['Gift wrap', 'Card']), FormAnswers::text(null)]);
        $this->assertSame('3', FormAnswers::check($props, ['f_people' => 3], true)['values']['f_people']);

        $bad = FormAnswers::check($props, [
            'f_email' => 'nope',
            'f_phone' => 'call me',
            'f_notes' => str_repeat('a', 501),
            'f_people' => 7,
            'f_size' => 'o_xl',
            'f_gift' => 'yes',
            'f_extras' => ['o_card', 'o_card'],
            'f_date' => '2026-02-30',
            'f_unknown' => 'x',
        ], false);
        $this->assertEqualsCanonicalizing([
            'values.f_name', 'values.f_email', 'values.f_phone', 'values.f_notes', 'values.f_people', 'values.f_size', 'values.f_time',
            'values.f_gift', 'values.f_extras', 'values.f_date', 'values.f_unknown', 'consent',
        ], array_keys($bad['errors']));
        $this->assertSame('Enter at most 6.', $bad['errors']['values.f_people']);
        $this->assertSame('Please fill in this field.', $bad['errors']['values.f_name']);
        $this->assertSame('This field is not part of the form.', $bad['errors']['values.f_unknown']);
        $this->assertSame('values', array_key_first(FormAnswers::check($props, ['a', 'b'], true)['errors']));
        $this->assertSame('Enter at least 1.', FormAnswers::check($props, ['f_people' => '0'], true)['errors']['values.f_people']);
        $this->assertSame('Enter a number (at most 2 decimals).', FormAnswers::check($props, ['f_people' => '1.234'], true)['errors']['values.f_people']);

        // A required checkbox must be ticked.
        $consentless = $props;
        $consentless['consent'] = null;
        $consentless['fields'] = [['id' => 'f_ok', 'kind' => 'checkbox', 'label' => 'I am over 18', 'placeholder' => '', 'help' => '', 'required' => true, 'options' => [], 'min' => null, 'max' => null, 'max_length' => null, 'reply_to' => false]];
        $this->assertSame('Please tick this box.', FormAnswers::check($consentless, ['f_ok' => false], null)['errors']['values.f_ok']);
        $this->assertSame(['f_ok' => true], FormAnswers::check($consentless, ['f_ok' => true], null)['values']);
    }
}
