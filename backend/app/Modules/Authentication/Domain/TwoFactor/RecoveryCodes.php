<?php

namespace App\Modules\Authentication\Domain\TwoFactor;

/**
 * One-time recovery codes for when the authenticator is lost: 10 codes of the form
 * `xxxxx-xxxxx` from lowercase letters and digits without look-alikes (0/o, 1/l/i).
 *
 * Only HMAC-SHA256 hashes (keyed with the application key) are stored. A keyed fast hash is
 * enough for ~49 bits of random code and lets a sign-in check all ten codes in one pass,
 * which a slow password hash (bcrypt × 10) would not.
 */
final class RecoveryCodes
{
    public const COUNT = 10;

    private const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

    /**
     * @return list<string> plain codes, shown to the user once
     */
    public function generate(int $count = self::COUNT): array
    {
        $codes = [];
        while (count($codes) < $count) {
            $code = $this->randomPart().'-'.$this->randomPart();
            $codes[$code] = true;
        }

        return array_keys($codes);
    }

    /**
     * The stored form of a code. Case, spaces and the dash do not matter.
     */
    public function hash(string $code, string $key): string
    {
        return hash_hmac('sha256', self::normalize($code), $key);
    }

    /**
     * The index of the hash matching $code, or null. Compares against every hash.
     *
     * @param  list<string>  $hashes
     */
    public function match(string $code, array $hashes, string $key): ?int
    {
        if (strlen(self::normalize($code)) !== 10) {
            return null;
        }

        $candidate = $this->hash($code, $key);
        $found = null;
        foreach ($hashes as $index => $hash) {
            if (hash_equals($hash, $candidate) && $found === null) {
                $found = $index;
            }
        }

        return $found;
    }

    public static function normalize(string $code): string
    {
        return strtolower((string) preg_replace('/[^A-Za-z0-9]/', '', $code));
    }

    private function randomPart(): string
    {
        $part = '';
        for ($i = 0; $i < 5; $i++) {
            $part .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        return $part;
    }
}
