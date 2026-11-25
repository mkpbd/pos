<?php

namespace App\Modules\StoredValue\Domain;

use InvalidArgumentException;

/**
 * A gift card / voucher / credit note code. Generated codes are 16 characters from an
 * alphabet without look-alikes (no 0/O, 1/I), shown as XXXX-XXXX-XXXX-XXXX; a pre-printed
 * card number may be 8–20 of A–Z and 0–9. Codes are compared case-insensitively without
 * dashes or spaces and stored only as the SHA-256 of that normalised form (plus the last 4).
 */
final readonly class GiftCardCode
{
    public const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public const LENGTH = 16;

    private function __construct(public string $value) {}

    public static function generate(): self
    {
        $max = strlen(self::ALPHABET) - 1;
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, $max)];
        }

        return new self($code);
    }

    /**
     * A pre-printed card number (8–20 letters/digits once normalised).
     *
     * @throws InvalidArgumentException
     */
    public static function prePrinted(string $input): self
    {
        $code = self::normalise($input);
        if (! self::isValidPrePrinted($code)) {
            throw new InvalidArgumentException('A card number is 8–20 letters and digits.');
        }

        return new self($code);
    }

    public static function isValidPrePrinted(string $input): bool
    {
        return preg_match('/^[A-Z0-9]{8,20}$/', self::normalise($input)) === 1;
    }

    /** Upper case, without dashes, spaces or other separators. */
    public static function normalise(string $input): string
    {
        return strtoupper((string) preg_replace('/[\s\-_.]+/', '', $input));
    }

    /** The hash stored and looked up for any (possibly unnormalised) code. */
    public static function hashOf(string $input): string
    {
        return hash('sha256', self::normalise($input));
    }

    public function hash(): string
    {
        return hash('sha256', $this->value);
    }

    public function last4(): string
    {
        return substr($this->value, -4);
    }

    /** As shown to people: groups of 4 separated by dashes. */
    public function formatted(): string
    {
        return implode('-', str_split($this->value, 4));
    }
}
