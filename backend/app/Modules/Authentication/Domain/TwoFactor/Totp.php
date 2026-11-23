<?php

namespace App\Modules\Authentication\Domain\TwoFactor;

use InvalidArgumentException;

/**
 * Time-based one-time passwords for authenticator apps (RFC 6238 over RFC 4226 HOTP):
 * HMAC-SHA1, 6 digits, 30-second steps. Secrets are Base32 (RFC 4648, no padding).
 *
 * Pure: no clock, no storage. Callers pass the timestamp and keep the last accepted step
 * (replay protection — a step is accepted only once, see TwoFactorAuthenticator).
 */
final class Totp
{
    public const DIGITS = 6;

    public const PERIOD = 30;

    /** Accepted clock drift, in steps on either side of the current one. */
    public const WINDOW = 1;

    private const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /**
     * A fresh shared secret: 20 random bytes (160 bits, the HMAC-SHA1 block recommendation), Base32.
     */
    public function generateSecret(): string
    {
        return self::base32Encode(random_bytes(20));
    }

    /**
     * The time step the code belongs to (within ±WINDOW steps of $timestamp), or null when it matches none.
     */
    public function verify(string $secret, string $code, int $timestamp): ?int
    {
        if (preg_match('/^\d{'.self::DIGITS.'}$/', $code) !== 1) {
            return null;
        }

        $key = self::base32Decode($secret);
        $current = intdiv($timestamp, self::PERIOD);
        $matched = null;

        // Every candidate is compared (no early exit) so timing does not reveal which step matched.
        for ($step = $current - self::WINDOW; $step <= $current + self::WINDOW; $step++) {
            if ($step >= 0 && hash_equals(self::hotp($key, $step, self::DIGITS), $code) && $matched === null) {
                $matched = $step;
            }
        }

        return $matched;
    }

    /**
     * The code for $timestamp (tests, and an authenticator's view of the secret).
     */
    public function at(string $secret, int $timestamp, int $digits = self::DIGITS): string
    {
        return self::hotp(self::base32Decode($secret), intdiv($timestamp, self::PERIOD), $digits);
    }

    /**
     * The `otpauth://` provisioning URI that authenticator apps read from the QR code.
     */
    public function uri(string $secret, string $issuer, string $account): string
    {
        return 'otpauth://totp/'.rawurlencode($issuer).':'.rawurlencode($account)
            .'?secret='.$secret
            .'&issuer='.rawurlencode($issuer)
            .'&algorithm=SHA1&digits='.self::DIGITS.'&period='.self::PERIOD;
    }

    public static function base32Encode(string $bytes): string
    {
        $bits = '';
        foreach (str_split($bytes) as $char) {
            $bits .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
        }

        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::BASE32[bindec(str_pad($chunk, 5, '0'))];
        }

        return $out;
    }

    public static function base32Decode(string $encoded): string
    {
        $encoded = strtoupper(rtrim(str_replace([' ', '-'], '', $encoded), '='));
        if ($encoded === '' || strspn($encoded, self::BASE32) !== strlen($encoded)) {
            throw new InvalidArgumentException('The secret is not valid Base32.');
        }

        $bits = '';
        foreach (str_split($encoded) as $char) {
            $bits .= str_pad(decbin((int) strpos(self::BASE32, $char)), 5, '0', STR_PAD_LEFT);
        }

        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr((int) bindec($byte));
            }
        }

        return $out;
    }

    /**
     * RFC 4226 HOTP with dynamic truncation.
     */
    private static function hotp(string $key, int $counter, int $digits): string
    {
        $hash = hash_hmac('sha1', pack('J', $counter), $key, true);
        $offset = ord($hash[19]) & 0x0F;
        $binary = ((ord($hash[$offset]) & 0x7F) << 24)
            | (ord($hash[$offset + 1]) << 16)
            | (ord($hash[$offset + 2]) << 8)
            | ord($hash[$offset + 3]);

        return str_pad((string) ($binary % (10 ** $digits)), $digits, '0', STR_PAD_LEFT);
    }
}
