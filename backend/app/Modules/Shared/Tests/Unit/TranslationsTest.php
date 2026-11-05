<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Translations;
use PHPUnit\Framework\TestCase;

/**
 * E12b: the one resolution rule (per-field fallback) and staff input of translations.
 */
class TranslationsTest extends TestCase
{
    public function test_each_field_falls_back_to_its_base_value(): void
    {
        $record = [
            'title' => 'About us',
            'subtitle' => 'Since 2012',
            'excerpt' => 'Base excerpt',
            'translations' => ['bn' => ['title' => 'আমাদের কথা', 'subtitle' => '   ']],
        ];

        $this->assertSame('আমাদের কথা', Translations::pick($record, 'title', 'bn'));
        $this->assertSame('Since 2012', Translations::pick($record, 'subtitle', 'bn'), 'Blank translations fall back.');
        $this->assertSame('Base excerpt', Translations::pick($record, 'excerpt', 'bn'), 'Missing translations fall back.');
        $this->assertSame('About us', Translations::pick($record, 'title', 'en'), 'English reads the base column.');
        $this->assertSame(['title' => 'আমাদের কথা', 'excerpt' => 'Base excerpt'], Translations::pickMany($record, ['title', 'excerpt'], 'bn'));
        $this->assertNull(Translations::pick(null, 'title', 'bn'));

        // Raw rows carry the document as JSON; objects (query builder rows) work too.
        $row = (object) ['name' => 'Rice', 'translations' => '{"bn":{"name":"চাল"}}'];
        $this->assertSame('চাল', Translations::pick($row, 'name', 'bn'));
        $this->assertSame('Rice', Translations::pick((object) ['name' => 'Rice', 'translations' => null], 'name', 'bn'));
        $this->assertSame('base', Translations::value('not json', 'name', 'bn', 'base'));
        $this->assertSame('base', Translations::value(['bn' => 'oops'], 'name', 'bn', 'base'));
    }

    public function test_staff_input_is_partial_trimmed_and_sanitized(): void
    {
        $sanitizer = new class implements HtmlSanitizer
        {
            public function clean(string $html): string
            {
                return str_replace('<script>x</script>', '', $html);
            }
        };
        $stored = ['bn' => ['title' => 'পুরনো', 'excerpt' => 'থাকবে']];

        $result = TranslationInput::apply($stored, ['bn' => [
            'title' => '  নতুন  ',
            'body_html' => '<p>লেখা</p><script>x</script>',
            'subtitle' => '',
            'unknown' => 'ignored',
        ]], ['title', 'excerpt', 'body_html', 'subtitle'], ['body_html'], $sanitizer);

        $this->assertSame(['bn' => ['body_html' => '<p>লেখা</p>', 'excerpt' => 'থাকবে', 'title' => 'নতুন']], $result);
        // A blank field removes its translation; the last one removes the locale; nothing left is null.
        $this->assertNull(TranslationInput::apply(['bn' => ['title' => 'x']], ['bn' => ['title' => ' ']], ['title']));
        $this->assertNull(TranslationInput::apply($stored, null, ['title']));
        $this->assertNull(TranslationInput::apply($stored, ['bn' => null], ['title']));
        $this->assertSame(['bn' => ['excerpt' => 'থাকবে', 'title' => 'পুরনো']], TranslationInput::apply($stored, [], ['title', 'excerpt']));
        // Rich text with no text left after sanitizing is removed.
        $this->assertNull(TranslationInput::apply(null, ['bn' => ['body_html' => '<script>x</script>']], ['body_html'], ['body_html'], $sanitizer));

        $this->assertEquals(['bn' => (object) []], TranslationInput::present(null));
        $this->assertSame(['bn' => ['title' => 'x']], TranslationInput::present('{"bn":{"title":"x"}}'));

        $rules = TranslationInput::rules(['title' => ['max:160']], 'items.*.translations');
        $this->assertSame(['sometimes', 'nullable', 'array:bn'], $rules['items.*.translations']);
        $this->assertSame(['sometimes', 'nullable', 'array:title'], $rules['items.*.translations.bn']);
        $this->assertSame(['sometimes', 'nullable', 'string', 'max:160'], $rules['items.*.translations.bn.title']);
    }

    public function test_locale_resolution(): void
    {
        $this->assertSame('bn', LocaleContext::resolve('bn', true, 'en'));
        $this->assertSame('bn', LocaleContext::resolve('BN', true, 'en'));
        $this->assertSame('en', LocaleContext::resolve('fr', true, 'en'), 'Unknown → default.');
        $this->assertSame('bn', LocaleContext::resolve(null, true, 'bn'), 'Missing → default.');
        $this->assertSame('en', LocaleContext::resolve('bn', false, 'en'), 'Bangla off → English.');
        $this->assertSame('en', LocaleContext::resolve(null, false, 'bn'), 'A disabled default is English.');

        $context = new LocaleContext;
        $context->configure(true, 'bn', 'bn', true);
        $this->assertSame(['bn', 'bn', true, ['en', 'bn']], [$context->current(), $context->defaultLocale(), $context->banglaDigits(), $context->enabled()]);
        $this->assertSame('en', $context->runAs('en', fn () => $context->current()));
        $this->assertSame('bn', $context->current());
        $context->reset();
        $this->assertSame(['en', ['en']], [$context->current(), $context->enabled()]);
        $this->assertSame('bn_BD', LocaleContext::ogLocale('bn'));
    }
}
