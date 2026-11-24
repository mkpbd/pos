<?php

namespace App\Modules\Sms\Domain;

/**
 * BD1a: how many SMS parts a text costs. Texts made only of GSM-7 characters (the basic table;
 * characters of the extension table count twice) fit 160 characters in one part or 153 per
 * part when split; anything else is sent as Unicode (UCS-2): 70 in one part, 67 per part
 * (lengths in UTF-16 code units, so an emoji counts twice). An empty text is 0 parts.
 */
final class SmsText
{
    private const BASIC = "@£\$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

    private const EXTENSION = "^{}\[~]|€\f";

    /** @var array<string, true>|null */
    private static ?array $basic = null;

    /** @var array<string, true>|null */
    private static ?array $extension = null;

    /**
     * @return array{encoding: 'gsm'|'unicode', length: int, segments: int}
     */
    public static function analyze(string $text): array
    {
        self::$basic ??= array_fill_keys(mb_str_split(self::BASIC), true);
        self::$extension ??= array_fill_keys(mb_str_split(self::EXTENSION), true);

        $length = 0;
        $gsm = true;
        foreach (mb_str_split($text) as $char) {
            if (isset(self::$basic[$char])) {
                $length++;
            } elseif (isset(self::$extension[$char])) {
                $length += 2;
            } else {
                $gsm = false;
                break;
            }
        }

        if ($gsm) {
            return ['encoding' => 'gsm', 'length' => $length, 'segments' => self::segments($length, 160, 153)];
        }

        $units = intdiv(strlen((string) mb_convert_encoding($text, 'UTF-16LE', 'UTF-8')), 2);

        return ['encoding' => 'unicode', 'length' => $units, 'segments' => self::segments($units, 70, 67)];
    }

    private static function segments(int $length, int $single, int $part): int
    {
        return match (true) {
            $length === 0 => 0,
            $length <= $single => 1,
            default => (int) ceil($length / $part),
        };
    }
}
