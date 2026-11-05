<?php

namespace App\Modules\Shared\Domain;

use Illuminate\Database\Eloquent\Model;

/**
 * Content translations (ADR-011, E12b): a record's optional `translations` document
 * `{"bn": {"title": "…", …}}` next to its base (English) columns.
 *
 * The one resolution rule of the storefront: a field reads its translation for the locale
 * when that is a non-blank string, else the base value — per field, so a half-translated
 * record shows Bangla where it has it and English elsewhere. Slugs are never translated.
 */
final class Translations
{
    /**
     * The localized value of `$field` of a record (model, row array or row object with a
     * `translations` member and the base field).
     *
     * @param  Model|array<string, mixed>|object|null  $record
     */
    public static function pick(object|array|null $record, string $field, string $locale): mixed
    {
        if ($record === null) {
            return null;
        }

        return self::value(self::of($record), $field, $locale, self::read($record, $field));
    }

    /**
     * Localized values of several fields of a record, keyed by field.
     *
     * @param  Model|array<string, mixed>|object  $record
     * @param  list<string>  $fields
     * @return array<string, mixed>
     */
    public static function pickMany(object|array $record, array $fields, string $locale): array
    {
        $translations = self::of($record);
        $result = [];
        foreach ($fields as $field) {
            $result[$field] = self::value($translations, $field, $locale, self::read($record, $field));
        }

        return $result;
    }

    /**
     * The translation of `$field` in `$locale` when it is a non-blank string, else `$base`
     * (base fields that live elsewhere, e.g. a product's name for its listing).
     *
     * @param  mixed  $translations  the document (array, JSON string or null)
     */
    public static function value(mixed $translations, string $field, string $locale, mixed $base): mixed
    {
        $value = self::decode($translations)[$locale][$field] ?? null;

        return is_string($value) && trim($value) !== '' ? $value : $base;
    }

    /**
     * The translations document of a record ([] when it has none).
     *
     * @param  Model|array<string, mixed>|object  $record
     * @return array<string, array<string, string>>
     */
    public static function of(object|array $record): array
    {
        return self::decode(self::read($record, 'translations'));
    }

    /**
     * A stored document as an array: JSON strings (raw rows) are decoded, anything that is
     * not a locale => fields object is dropped.
     *
     * @return array<string, array<string, string>>
     */
    public static function decode(mixed $raw): array
    {
        if (is_string($raw)) {
            $raw = json_decode($raw, true);
        }
        if (! is_array($raw)) {
            return [];
        }

        $result = [];
        foreach ($raw as $locale => $fields) {
            if (is_string($locale) && is_array($fields)) {
                $result[$locale] = array_filter($fields, fn ($v, $k) => is_string($k) && is_string($v), ARRAY_FILTER_USE_BOTH);
            }
        }

        return $result;
    }

    /**
     * The document as it is stored: locales without fields dropped, null when empty.
     *
     * @param  array<string, array<string, string>>  $translations
     * @return array<string, array<string, string>>|null
     */
    public static function compact(array $translations): ?array
    {
        $translations = array_filter($translations, fn ($fields) => is_array($fields) && $fields !== []);
        ksort($translations);
        foreach ($translations as &$fields) {
            ksort($fields);
        }

        return $translations === [] ? null : $translations;
    }

    /**
     * @param  Model|array<string, mixed>|object  $record
     */
    private static function read(object|array $record, string $key): mixed
    {
        if ($record instanceof Model) {
            // Selected columns only: a row loaded without the column has no translations.
            return array_key_exists($key, $record->getAttributes()) ? $record->getAttribute($key) : null;
        }
        if (is_array($record)) {
            return $record[$key] ?? null;
        }

        return $record->{$key} ?? null;
    }
}
