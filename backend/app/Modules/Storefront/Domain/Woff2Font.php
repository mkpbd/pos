<?php

namespace App\Modules\Storefront\Domain;

/**
 * B10: whether bytes are a WOFF2 font file — by its header, never by the name or the type the
 * browser reported: the signature `wOF2`, a known flavour (TrueType, OpenType/CFF or a
 * collection), the header's total length equal to the file size, 1–255 tables and a zero
 * reserved field (WOFF2 spec §3, a 48-byte header).
 */
final class Woff2Font
{
    public const MAX_BYTES = 500 * 1024;

    private const HEADER_BYTES = 48;

    private const FLAVOURS = ["\x00\x01\x00\x00", 'OTTO', 'true', 'ttcf'];

    public static function isValid(string $bytes): bool
    {
        $size = strlen($bytes);
        if ($size < self::HEADER_BYTES || $size > self::MAX_BYTES || ! str_starts_with($bytes, 'wOF2')) {
            return false;
        }
        if (! in_array(substr($bytes, 4, 4), self::FLAVOURS, true)) {
            return false;
        }
        /** @var array{length: int, tables: int, reserved: int} $header */
        $header = unpack('Nlength/ntables/nreserved', $bytes, 8);

        return $header['length'] === $size && $header['tables'] >= 1 && $header['tables'] <= 255 && $header['reserved'] === 0;
    }
}
