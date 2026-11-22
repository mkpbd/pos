<?php

namespace App\Modules\Storefront\Application\Builder\Wizard;

use RuntimeException;

/**
 * B21: the wizard's built-in texts (`resources/builder-wizard/copy.json`, original plain text in
 * English and Bangla): per recipe slot, optionally per product source (`<slot>:<source>`) and
 * per page type (`pages.<page type>.<slot>`), a list of variants per language; the variant is
 * picked from the page title, so the same title gives the same texts. Placeholders `{store}`,
 * `{title}` and `{category}` are filled here.
 */
class WizardCopy
{
    /** @var array<string, mixed>|null */
    private ?array $copy = null;

    public static function path(): string
    {
        return resource_path('builder-wizard/copy.json');
    }

    /**
     * The texts of a slot: `{field: {en, bn}}` (empty when the slot has none).
     *
     * @param  array{store: string, title: string, category: ?string}  $facts
     * @return array<string, array{en: string, bn: string}>
     */
    public function texts(string $pageType, string $slot, ?string $source, array $facts): array
    {
        $copy = $this->copy();
        $entry = null;
        foreach (array_filter([$source === null ? null : "{$slot}:{$source}", $slot]) as $key) {
            $entry = $copy['pages'][$pageType][$key] ?? $copy['slots'][$key] ?? null;
            if ($entry !== null) {
                break;
            }
        }
        if (! is_array($entry) || ! is_array($entry['en'] ?? null) || $entry['en'] === []) {
            return [];
        }
        $index = crc32(mb_strtolower($facts['title'])) % count($entry['en']);
        $en = $entry['en'][$index];
        $bn = $entry['bn'][$index] ?? $entry['bn'][0] ?? $en;

        $texts = [];
        foreach ($en as $field => $text) {
            $texts[$field] = [
                'en' => self::fill((string) $text, $facts, 'en'),
                'bn' => self::fill((string) ($bn[$field] ?? $text), $facts, 'bn'),
            ];
        }

        return $texts;
    }

    /**
     * @param  array{store: string, title: string, category: ?string}  $facts
     */
    private static function fill(string $text, array $facts, string $language): string
    {
        return strtr($text, [
            '{store}' => $facts['store'],
            '{title}' => $facts['title'],
            '{category}' => $facts['category'] ?? ($language === 'bn' ? 'আমাদের পণ্য' : 'Our products'),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function copy(): array
    {
        if ($this->copy === null) {
            if (! is_file(self::path())) {
                throw new RuntimeException('The page wizard texts are missing: '.self::path());
            }
            $this->copy = json_decode((string) file_get_contents(self::path()), true, flags: JSON_THROW_ON_ERROR);
        }

        return $this->copy;
    }
}
