<?php

namespace App\Modules\Authentication\Domain\Pin;

/**
 * POS1a: what makes an acceptable till PIN — 4 to 6 digits, not all the same digit and not a
 * straight run up or down (1234, 4321, 012345, 987654).
 */
final class PinRules
{
    public const MIN_LENGTH = 4;

    public const MAX_LENGTH = 6;

    /**
     * @return string|null why the PIN is refused, or null when it is acceptable
     */
    public static function violation(string $pin): ?string
    {
        if (preg_match('/^\d{'.self::MIN_LENGTH.','.self::MAX_LENGTH.'}$/', $pin) !== 1) {
            return 'The PIN must be '.self::MIN_LENGTH.' to '.self::MAX_LENGTH.' digits.';
        }

        if (count(array_unique(str_split($pin))) === 1) {
            return 'The PIN cannot be the same digit repeated.';
        }

        if (self::isStraight($pin, 1) || self::isStraight($pin, -1)) {
            return 'The PIN cannot be a run of digits such as 1234 or 4321.';
        }

        return null;
    }

    private static function isStraight(string $pin, int $step): bool
    {
        for ($i = 1, $n = strlen($pin); $i < $n; $i++) {
            if ((int) $pin[$i] - (int) $pin[$i - 1] !== $step) {
                return false;
            }
        }

        return true;
    }
}
