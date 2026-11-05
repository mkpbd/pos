<?php

namespace App\Modules\Shared\Application\Support;

use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;

/**
 * Staff input of content translations (E12b): `translations: {bn: {field: value}}`.
 *
 * - Only translatable locales (`bn`) and the entity's listed fields are accepted (others 422),
 *   each with the limits of its base field.
 * - Partial: a sent field replaces its translation, a blank (empty / whitespace / null) one
 *   removes it, fields not sent are kept. `translations: null` or `{bn: null}` removes them all.
 * - HTML fields go through the HtmlSanitizer like the base field; one with no text left is removed.
 */
final class TranslationInput
{
    /**
     * Validation rules for `$prefix` (`translations`, `items.*.translations`, …).
     *
     * @param  array<string, list<mixed>|string>  $fields  field => rules of the value (e.g. ['max:160'])
     * @return array<string, list<mixed>>
     */
    public static function rules(array $fields, string $prefix = 'translations'): array
    {
        $rules = [$prefix => ['sometimes', 'nullable', 'array:'.implode(',', LocaleContext::TRANSLATABLE)]];
        foreach (LocaleContext::TRANSLATABLE as $locale) {
            $rules["{$prefix}.{$locale}"] = ['sometimes', 'nullable', 'array:'.implode(',', array_keys($fields))];
            foreach ($fields as $field => $valueRules) {
                $rules["{$prefix}.{$locale}.{$field}"] = ['sometimes', 'nullable', 'string', ...(array) $valueRules];
            }
        }

        return $rules;
    }

    /**
     * The document to store after applying the validated input to the stored one, or null
     * when nothing is left.
     *
     * @param  mixed  $stored  the record's current document (null for new records / replacing)
     * @param  mixed  $input  validated `translations` value
     * @param  list<string>  $fields  accepted fields
     * @param  list<string>  $htmlFields  fields sanitized as rich text
     * @return array<string, array<string, string>>|null
     */
    public static function apply(mixed $stored, mixed $input, array $fields, array $htmlFields = [], ?HtmlSanitizer $sanitizer = null): ?array
    {
        $result = array_intersect_key(Translations::decode($stored), array_flip(LocaleContext::TRANSLATABLE));
        if ($input === null) {
            return null;
        }
        if (! is_array($input)) {
            return Translations::compact($result);
        }

        foreach (LocaleContext::TRANSLATABLE as $locale) {
            if (! array_key_exists($locale, $input)) {
                continue;
            }
            if (! is_array($input[$locale])) {
                unset($result[$locale]);

                continue;
            }
            foreach ($input[$locale] as $field => $value) {
                if (! in_array($field, $fields, true)) {
                    continue;
                }
                $clean = self::clean($value, in_array($field, $htmlFields, true) ? $sanitizer : null);
                if ($clean === null) {
                    unset($result[$locale][$field]);
                } else {
                    $result[$locale][$field] = $clean;
                }
            }
        }

        return Translations::compact($result);
    }

    /**
     * Keeps only the given fields of a stored document (e.g. after a section's type
     * narrowed what can be translated).
     *
     * @param  list<string>  $fields
     * @return array<string, array<string, string>>|null
     */
    public static function only(mixed $stored, array $fields): ?array
    {
        $result = [];
        foreach (Translations::decode($stored) as $locale => $values) {
            $result[$locale] = array_intersect_key($values, array_flip($fields));
        }

        return Translations::compact($result);
    }

    /**
     * The document as staff APIs return it: always an object with every translatable locale.
     *
     * @return array<string, array<string, string>|object>
     */
    public static function present(mixed $stored): array
    {
        $decoded = Translations::decode($stored);
        $result = [];
        foreach (LocaleContext::TRANSLATABLE as $locale) {
            $result[$locale] = ($decoded[$locale] ?? []) === [] ? (object) [] : $decoded[$locale];
        }

        return $result;
    }

    private static function clean(mixed $value, ?HtmlSanitizer $sanitizer): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }
        if ($sanitizer === null) {
            return trim($value);
        }
        $html = $sanitizer->clean($value);

        return trim(strip_tags($html, '<img>')) === '' ? null : $html;
    }
}
