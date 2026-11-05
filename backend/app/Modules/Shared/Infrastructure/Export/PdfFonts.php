<?php

namespace App\Modules\Shared\Infrastructure\Export;

/**
 * @font-face rules for the vendored OFL fonts (resources/fonts), inlined as data URIs so the
 * PDF renderer needs no network or file access: Poppins for Latin text, Hind Siliguri for
 * Bangla (and as the Latin fallback).
 */
final class PdfFonts
{
    private const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';

    private const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

    private const BENGALI = 'U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1';

    /** Family => [file prefix, [subset => unicode-range]]. */
    private const FAMILIES = [
        'Poppins' => ['poppins', ['latin' => self::LATIN, 'latin-ext' => self::LATIN_EXT]],
        'Hind Siliguri' => ['hind-siliguri', ['bengali' => self::BENGALI, 'latin' => self::LATIN, 'latin-ext' => self::LATIN_EXT]],
    ];

    private static ?string $css = null;

    public static function css(): string
    {
        if (self::$css !== null) {
            return self::$css;
        }

        $rules = [];
        foreach (self::FAMILIES as $family => [$prefix, $subsets]) {
            foreach ([400, 600] as $weight) {
                foreach ($subsets as $subset => $range) {
                    $file = resource_path("fonts/{$prefix}-{$subset}-{$weight}-normal.woff2");
                    if (! is_file($file)) {
                        continue;
                    }
                    $data = base64_encode((string) file_get_contents($file));
                    $rules[] = "@font-face{font-family:'{$family}';font-style:normal;font-weight:{$weight};"
                        ."src:url(data:font/woff2;base64,{$data}) format('woff2');unicode-range:{$range};}";
                }
            }
        }

        return self::$css = implode("\n", $rules);
    }
}
