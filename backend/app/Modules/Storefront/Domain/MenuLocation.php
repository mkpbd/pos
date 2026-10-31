<?php

namespace App\Modules\Storefront\Domain;

/**
 * Where a menu is shown. The mobile drawer falls back to the main menu when no
 * mobile menu is configured.
 */
enum MenuLocation: string
{
    case Main = 'main';
    case Mobile = 'mobile';
    case Footer1 = 'footer_1';
    case Footer2 = 'footer_2';
    case Footer3 = 'footer_3';

    public function label(): string
    {
        return match ($this) {
            self::Main => 'Main navigation',
            self::Mobile => 'Mobile menu',
            self::Footer1 => 'Footer column 1',
            self::Footer2 => 'Footer column 2',
            self::Footer3 => 'Footer column 3',
        };
    }

    public function allowsMega(): bool
    {
        return $this === self::Main;
    }
}
