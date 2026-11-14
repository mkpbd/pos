<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Domain\Woff2Font;
use PHPUnit\Framework\TestCase;

/**
 * B10: WOFF2 header checks and the theme's font roles (Bangla roles effective, custom fonts).
 */
class ThemeFontsTest extends TestCase
{
    private const FONT = 'custom:0195f1e2-0000-7000-8000-00000000000a';

    private static function woff2(string $flavour = "\x00\x01\x00\x00", int $tables = 2, int $reserved = 0, ?int $length = null): string
    {
        $body = str_repeat('z', 20);

        return 'wOF2'.$flavour.pack('N', $length ?? 48 + strlen($body)).pack('n', $tables).pack('n', $reserved).str_repeat("\x00", 32).$body;
    }

    public function test_woff2_files_are_recognized_by_their_header(): void
    {
        $this->assertTrue(Woff2Font::isValid(self::woff2()));
        $this->assertTrue(Woff2Font::isValid(self::woff2('OTTO')));
        $this->assertFalse(Woff2Font::isValid('wOFF'.substr(self::woff2(), 4)), 'WOFF 1');
        $this->assertFalse(Woff2Font::isValid(self::woff2('abcd')));
        $this->assertFalse(Woff2Font::isValid(self::woff2(tables: 0)));
        $this->assertFalse(Woff2Font::isValid(self::woff2(reserved: 1)));
        $this->assertFalse(Woff2Font::isValid(self::woff2(length: 10)));
        $this->assertFalse(Woff2Font::isValid('wOF2'));
        $this->assertFalse(Woff2Font::isValid(''));
    }

    public function test_bangla_roles_follow_the_choice_then_the_main_font_then_todays_fonts(): void
    {
        $this->assertSame(
            ['heading' => 'baloo', 'body' => 'poppins', 'bangla_heading' => 'baloo-da-2', 'bangla_body' => 'hind-siliguri'],
            ThemeSchema::fonts(ThemeSchema::defaults()),
        );
        $theme = ThemeSchema::normalize(['typography' => ['heading_font' => 'noto-sans-bengali', 'body_font' => strtoupper(self::FONT), 'bangla_body_font' => 'tiro-bangla']]);
        $this->assertSame(
            ['heading' => 'noto-sans-bengali', 'body' => self::FONT, 'bangla_heading' => 'noto-sans-bengali', 'bangla_body' => 'tiro-bangla'],
            ThemeSchema::fonts($theme),
        );
        $this->assertSame(['0195f1e2-0000-7000-8000-00000000000a'], ThemeSchema::customFontIds($theme));
        $this->assertSame(['body'], ThemeSchema::customFontRoles($theme, '0195f1e2-0000-7000-8000-00000000000a'));

        $restored = ThemeSchema::withoutMissingFonts(ThemeSchema::normalize(['typography' => ['heading_font' => self::FONT, 'bangla_body_font' => self::FONT]]), []);
        $this->assertSame(['baloo', null], [$restored['typography']['heading_font'], $restored['typography']['bangla_body_font']]);
    }

    public function test_bangla_spacing_numbers_have_one_form(): void
    {
        $theme = ThemeSchema::normalize(['typography' => ['bangla_line_height' => '1.80', 'bangla_scale' => 1.0]]);
        $this->assertSame([1.8, 1], [$theme['typography']['bangla_line_height'], $theme['typography']['bangla_scale']]);
    }
}
