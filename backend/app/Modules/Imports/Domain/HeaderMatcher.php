<?php

namespace App\Modules\Imports\Domain;

/**
 * Maps a file's header row to column keys. Matching ignores case, spaces, dashes and
 * punctuation ("Selling Price", "selling_price", " SELLING-PRICE ") and accepts a column's key
 * or its label. Blank header cells (trailing empty columns) are ignored.
 */
final class HeaderMatcher
{
    /**
     * `map` is cell index → column key; `missing` lists required keys not found.
     *
     * @param  list<array{key: string, label: string, required: bool}>  $columns
     * @param  list<?string>  $header  the file's header cells
     * @return array{map: array<int, string>, missing: list<string>, unknown: list<string>, duplicate: list<string>}
     */
    public static function match(array $columns, array $header): array
    {
        $lookup = [];
        foreach ($columns as $column) {
            $lookup[self::normalize($column['key'])] = $column['key'];
            $lookup[self::normalize($column['label'])] ??= $column['key'];
        }

        $map = [];
        $unknown = [];
        $duplicate = [];
        foreach ($header as $index => $cell) {
            $text = trim((string) $cell);
            if ($text === '') {
                continue;
            }
            $key = $lookup[self::normalize($text)] ?? null;
            if ($key === null) {
                $unknown[] = $text;
            } elseif (in_array($key, $map, true)) {
                $duplicate[] = $text;
            } else {
                $map[$index] = $key;
            }
        }

        $missing = [];
        foreach ($columns as $column) {
            if ($column['required'] && ! in_array($column['key'], $map, true)) {
                $missing[] = $column['key'];
            }
        }

        return ['map' => $map, 'missing' => $missing, 'unknown' => $unknown, 'duplicate' => $duplicate];
    }

    public static function normalize(string $text): string
    {
        $text = mb_strtolower(trim(str_replace("\u{FEFF}", '', $text)));

        return trim((string) preg_replace('/[^\p{L}\p{N}]+/u', '_', $text), '_');
    }
}
