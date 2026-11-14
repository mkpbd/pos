<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: deterministic caption suggestions (used when AI is off or fails): three captions per
 * language (`en`, `bn`) and tone (`friendly`, `festive`, `short`) from the product's name, price,
 * sale price and offer, the store's name and hashtags made from the store, category and brand
 * names. The post's link is added when it is published, so captions carry none.
 */
final class CaptionTemplates
{
    public const LANGUAGES = ['en', 'bn'];

    public const TONES = ['friendly', 'festive', 'short'];

    private const MAX_TAGS = 5;

    /**
     * @param  array{name: string, price: string, sale_price?: ?string, offer?: ?string, store: string, brand?: ?string, category?: ?string}  $facts
     *                                                                                                                                                amounts as decimal strings ("450.00")
     * @return list<string> three captions
     */
    public static function captions(array $facts, string $language, string $tone): array
    {
        $language = in_array($language, self::LANGUAGES, true) ? $language : 'en';
        $tone = in_array($tone, self::TONES, true) ? $tone : 'friendly';
        $vars = [
            '{name}' => trim($facts['name']),
            '{store}' => trim($facts['store']),
            '{price_line}' => self::priceLine($facts, $language),
            '{price_short}' => self::priceShort($facts, $language),
            '{tags}' => implode(' ', self::hashtags([$facts['store'], $facts['category'] ?? null, $facts['brand'] ?? null])),
            '{store_tag}' => implode(' ', self::hashtags([$facts['store']])),
        ];

        return array_map(
            fn (string $template) => trim((string) preg_replace("/\n{3,}/", "\n\n", strtr($template, $vars))),
            self::TEMPLATES[$language][$tone],
        );
    }

    /**
     * "৳450", "৳1,250.50" — whole amounts without decimals, thousands grouped.
     */
    public static function money(string $amount): string
    {
        $negative = str_starts_with($amount, '-');
        [$whole, $fraction] = array_pad(explode('.', ltrim($amount, '-'), 2), 2, '');
        $whole = ltrim($whole, '0') === '' ? '0' : ltrim($whole, '0');
        $grouped = strrev(implode(',', str_split(strrev($whole), 3)));
        $fraction = rtrim(substr($fraction.'00', 0, 2), '0') === '' ? '' : '.'.substr($fraction.'00', 0, 2);

        return ($negative ? '-' : '').'৳'.$grouped.$fraction;
    }

    /**
     * Hashtags from names: letters, marks and digits of any script kept, everything else dropped
     * ("Classic Shop" → #ClassicShop); duplicates (case-insensitive) and empty ones left out.
     *
     * @param  list<?string>  $names
     * @return list<string>
     */
    public static function hashtags(array $names): array
    {
        $tags = [];
        foreach ($names as $name) {
            if (! is_string($name)) {
                continue;
            }
            $words = preg_split('/[^\p{L}\p{M}\p{N}]+/u', trim($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            $tag = implode('', array_map(fn (string $w) => mb_strtoupper(mb_substr($w, 0, 1)).mb_substr($w, 1), $words));
            if ($tag !== '' && ! isset($tags[mb_strtolower($tag)]) && preg_match('/^\p{N}+$/u', $tag) !== 1) {
                $tags[mb_strtolower($tag)] = '#'.$tag;
            }
        }

        return array_slice(array_values($tags), 0, self::MAX_TAGS);
    }

    /**
     * @param  array<string, mixed>  $facts
     */
    private static function priceLine(array $facts, string $language): string
    {
        $price = self::money((string) $facts['price']);
        $sale = is_string($facts['sale_price'] ?? null) ? self::money($facts['sale_price']) : null;
        $offer = is_string($facts['offer'] ?? null) && trim($facts['offer']) !== '' ? trim($facts['offer']).': ' : '';
        if ($language === 'bn') {
            return $sale === null ? "দাম: {$price}" : "{$offer}এখন মাত্র {$sale} (আগে {$price})";
        }

        return $sale === null ? "Price: {$price}" : "{$offer}now {$sale} (was {$price})";
    }

    /**
     * @param  array<string, mixed>  $facts
     */
    private static function priceShort(array $facts, string $language): string
    {
        $price = self::money((string) $facts['price']);
        $sale = is_string($facts['sale_price'] ?? null) ? self::money($facts['sale_price']) : null;
        if ($sale === null) {
            return $price;
        }

        return $language === 'bn' ? "মাত্র {$sale} (আগে {$price})" : "{$sale} (was {$price})";
    }

    /** @var array<string, array<string, list<string>>> */
    private const TEMPLATES = [
        'en' => [
            'friendly' => [
                "{name} is here! ✨\n{price_line}\nTap the link to order 👇\n\n{tags}",
                "Looking for something special? Meet {name} from {store} 💛\n{price_line}\n\n{tags}",
                "A new favourite: {name} 😍\n{price_line}\nOrder today and we'll bring it to your door 🚚\n\n{tags}",
            ],
            'festive' => [
                "🎉 Celebrate with {name}!\n{price_line}\nMake this season special — order today.\n\n{tags}",
                "✨ Festive pick from {store}: {name} ✨\n{price_line}\nA lovely gift for the people you love 🎁\n\n{tags}",
                "🎊 Eid, weddings, birthdays — {name} fits every celebration!\n{price_line}\n\n{tags}",
            ],
            'short' => [
                "{name} — {price_short} 👇\n{store_tag}",
                "New: {name}. {price_short}.\n{store_tag}",
                "{name} at {store}. {price_short} 🛍️\n{store_tag}",
            ],
        ],
        'bn' => [
            'friendly' => [
                "{name} এখন পাওয়া যাচ্ছে! ✨\n{price_line}\nঅর্ডার করতে নিচের লিংকে ক্লিক করুন 👇\n\n{tags}",
                "বিশেষ কিছু খুঁজছেন? {store}-এর {name} দেখুন 💛\n{price_line}\n\n{tags}",
                "সবার পছন্দের {name}! 😍\n{price_line}\nআজই অর্ডার করুন, আমরা পৌঁছে দেব আপনার দরজায় 🚚\n\n{tags}",
            ],
            'festive' => [
                "🎉 উৎসবের আনন্দে {name}!\n{price_line}\nএই উৎসবকে করুন আরও রঙিন — আজই অর্ডার করুন।\n\n{tags}",
                "✨ {store}-এর উৎসব স্পেশাল: {name} ✨\n{price_line}\nপ্রিয়জনের জন্য সেরা উপহার 🎁\n\n{tags}",
                "🎊 ঈদ, বিয়ে, জন্মদিন — সব উৎসবে {name}!\n{price_line}\n\n{tags}",
            ],
            'short' => [
                "{name} — {price_short} 👇\n{store_tag}",
                "নতুন: {name}। {price_short}।\n{store_tag}",
                "{store}-এ {name}। {price_short} 🛍️\n{store_tag}",
            ],
        ],
    ];
}
