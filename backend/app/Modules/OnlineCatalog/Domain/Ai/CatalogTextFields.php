<?php

namespace App\Modules\OnlineCatalog\Domain\Ai;

/**
 * AI2a: the listing texts the AI writer and AI drafts work on, per subject. `description` is the
 * listing's rich-text `description_html` for products and categories and the plain-text
 * `description` of a brand. Bangla goes to the E12b translation of the same listing field.
 */
final class CatalogTextFields
{
    public const SUBJECTS = ['product', 'category', 'brand'];

    public const FIELDS = ['short_description', 'description', 'seo_title', 'seo_description'];

    public const LANGUAGES = ['en', 'bn'];

    public const TONES = ['friendly', 'formal', 'festive', 'simple'];

    public const LENGTHS = ['short', 'medium', 'long'];

    public const NOTES_MAX = 1000;

    /** Limits of the listing fields (SaveProductListing / SaveCategoryListing / SaveBrandListing). */
    private const LIMITS = [
        'product' => ['short_description' => 500, 'description' => 100000, 'seo_title' => 70, 'seo_description' => 160],
        'category' => ['description' => 50000, 'seo_title' => 70, 'seo_description' => 160],
        'brand' => ['description' => 1000, 'seo_title' => 70, 'seo_description' => 160],
    ];

    /**
     * The fields a subject has, in the canonical order.
     *
     * @return list<string>
     */
    public static function forSubject(string $subject): array
    {
        return array_keys(self::LIMITS[$subject] ?? []);
    }

    /**
     * The requested fields that apply to the subject, in the canonical order.
     *
     * @param  list<string>  $fields
     * @return list<string>
     */
    public static function applicable(string $subject, array $fields): array
    {
        return array_values(array_intersect(self::forSubject($subject), $fields));
    }

    public static function limit(string $subject, string $field): int
    {
        return self::LIMITS[$subject][$field] ?? 0;
    }

    /** The listing column (and translation key) of a field. */
    public static function column(string $subject, string $field): string
    {
        return $field === 'description' && $subject !== 'brand' ? 'description_html' : $field;
    }

    /** Whether the field is stored as rich text (sanitized HTML). */
    public static function isHtml(string $subject, string $field): bool
    {
        return self::column($subject, $field) === 'description_html';
    }

    /**
     * Fingerprint of a field's text when a draft was written (`base_hash`): a draft is stale when
     * the text changed since.
     */
    public static function hash(?string $text): string
    {
        return hash('xxh128', trim((string) $text));
    }
}
