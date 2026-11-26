<?php

namespace App\Modules\Sms\Domain;

/**
 * BD1a: order message templates. Placeholders {shop} {name} {order} {total} {link} {courier}
 * {tracking} {tracking_link} are replaced (a missing value by nothing, then double spaces are
 * collapsed); anything else in braces is left as typed.
 *
 * POS1d: `sale_receipt` — the digital receipt of a till sale ({shop} {name} {invoice} {total}
 * {link}), sent on demand by the cashier.
 */
final class SmsTemplate
{
    public const PLACEHOLDERS = ['shop', 'name', 'order', 'total', 'link', 'courier', 'tracking', 'tracking_link', 'invoice'];

    public const MAX_LENGTH = 480;

    /** Events switched on until the merchant changes them (payment confirmations are off). */
    public const ENABLED_BY_DEFAULT = ['order_placed' => true, 'order_confirmed' => false, 'order_shipped' => true, 'order_delivered' => true, 'order_cancelled' => true, 'sale_receipt' => true];

    /**
     * @param  array<string, string|int|float|null>  $vars
     */
    public static function render(string $template, array $vars): string
    {
        $text = preg_replace_callback('/\{([a-z_]+)\}/', function (array $m) use ($vars) {
            if (! in_array($m[1], self::PLACEHOLDERS, true)) {
                return $m[0];
            }
            $value = $vars[$m[1]] ?? null;

            return $value === null ? '' : trim((string) $value);
        }, $template) ?? $template;

        return trim((string) preg_replace('/ {2,}/', ' ', $text));
    }

    /**
     * The built-in templates per event, in English and Bangla.
     *
     * @return array<string, array{enabled: bool, en: string, bn: string}>
     */
    public static function defaults(): array
    {
        $texts = [
            'order_placed' => [
                'en' => '{shop}: Order {order} received. Total Tk {total}. Track: {link}',
                'bn' => '{shop}: আপনার অর্ডার {order} গৃহীত হয়েছে। মোট ৳{total}। ট্র্যাক: {link}',
            ],
            'order_confirmed' => [
                'en' => '{shop}: Payment for order {order} received. Thank you! {link}',
                'bn' => '{shop}: অর্ডার {order}-এর পেমেন্ট পাওয়া গেছে। ধন্যবাদ! {link}',
            ],
            'order_shipped' => [
                'en' => '{shop}: Order {order} handed to {courier}, tracking {tracking} {tracking_link}',
                'bn' => '{shop}: অর্ডার {order} {courier}-এর কাছে হস্তান্তর করা হয়েছে, ট্র্যাকিং {tracking} {tracking_link}',
            ],
            'order_delivered' => [
                'en' => '{shop}: Order {order} delivered. Thank you for shopping with us!',
                'bn' => '{shop}: অর্ডার {order} ডেলিভারি হয়েছে। আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ!',
            ],
            'order_cancelled' => [
                'en' => '{shop}: Order {order} has been cancelled. {link}',
                'bn' => '{shop}: অর্ডার {order} বাতিল করা হয়েছে। {link}',
            ],
            'sale_receipt' => [
                'en' => '{shop}: Receipt {invoice}, total Tk {total}. Thank you for shopping with us! {link}',
                'bn' => '{shop}: রসিদ {invoice}, মোট ৳{total}। আমাদের সাথে কেনাকাটার জন্য ধন্যবাদ! {link}',
            ],
        ];

        $defaults = [];
        foreach ($texts as $event => $text) {
            $defaults[$event] = ['enabled' => self::ENABLED_BY_DEFAULT[$event]] + $text;
        }

        return $defaults;
    }

    /**
     * The saved templates over the defaults (a missing event or key keeps its default).
     *
     * @param  array<string, mixed>|null  $saved
     * @return array<string, array{enabled: bool, en: string, bn: string}>
     */
    public static function effective(?array $saved): array
    {
        $templates = self::defaults();
        foreach ($templates as $event => $default) {
            $row = is_array($saved[$event] ?? null) ? $saved[$event] : [];
            if (array_key_exists('enabled', $row) && is_bool($row['enabled'])) {
                $templates[$event]['enabled'] = $row['enabled'];
            }
            foreach (['en', 'bn'] as $locale) {
                if (array_key_exists($locale, $row) && (is_string($row[$locale]) || $row[$locale] === null)) {
                    $templates[$event][$locale] = (string) $row[$locale];
                }
            }
        }

        return $templates;
    }

    /**
     * The template text of an event for a locale: Bangla for `bn` (an empty Bangla text falls
     * back to English), else English; an empty English text falls back to the default.
     *
     * @param  array{enabled: bool, en: string, bn: string}  $template
     */
    public static function textFor(string $event, array $template, string $locale): string
    {
        $en = trim($template['en']) !== '' ? $template['en'] : (self::defaults()[$event]['en'] ?? '');
        if ($locale === 'bn' && trim($template['bn']) !== '') {
            return $template['bn'];
        }

        return $en;
    }
}
