<?php

namespace App\Modules\Shared\Application\Localization;

/**
 * The few fixed words the server writes into page titles and breadcrumbs (E12b): the HTML
 * shell's titles and the catalog's "Home" crumb. Everything else is store content
 * (translated per record) or the storefront SPA's own dictionary.
 */
final class FixedText
{
    private const BN = [
        'Home' => 'হোম',
        'Blog' => 'ব্লগ',
        'Shop' => 'শপ',
        'Search' => 'অনুসন্ধান',
        'Cart' => 'কার্ট',
        'Wishlist' => 'উইশলিস্ট',
        'Checkout' => 'চেকআউট',
        'My account' => 'আমার অ্যাকাউন্ট',
        'Your order' => 'আপনার অর্ডার',
    ];

    public static function get(string $text, string $locale): string
    {
        return $locale === LocaleContext::BN ? (self::BN[$text] ?? $text) : $text;
    }
}
