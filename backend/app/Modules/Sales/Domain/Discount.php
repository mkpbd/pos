<?php

namespace App\Modules\Sales\Domain;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use InvalidArgumentException;

/**
 * A requested discount: a percentage of the amount it applies to, or a fixed amount.
 */
final readonly class Discount
{
    private function __construct(
        public DiscountType $type,
        public string $value,
    ) {}

    public static function percent(string $percent): self
    {
        if (Decimal::isNegative($percent) || Decimal::compare($percent, '100') > 0) {
            throw new InvalidArgumentException('A discount percentage must be between 0 and 100.');
        }

        return new self(DiscountType::Percent, Decimal::round($percent, 2));
    }

    public static function amount(string $amount): self
    {
        if (Decimal::isNegative($amount)) {
            throw new InvalidArgumentException('A discount amount must not be negative.');
        }

        return new self(DiscountType::Amount, Decimal::round($amount, 2));
    }

    /**
     * @param  array{type: string, value: string|int|float}|null  $data
     */
    public static function fromArray(?array $data): ?self
    {
        if ($data === null) {
            return null;
        }

        return DiscountType::from($data['type']) === DiscountType::Percent
            ? self::percent((string) $data['value'])
            : self::amount((string) $data['value']);
    }

    /**
     * @return array{type: string, value: string}
     */
    public function toArray(): array
    {
        return ['type' => $this->type->value, 'value' => $this->value];
    }

    public function isZero(): bool
    {
        return Decimal::isZero($this->value);
    }

    /**
     * The discount on $base, rounded to currency scale.
     *
     * @throws BusinessRuleViolation DISCOUNT_NOT_ALLOWED when a fixed amount exceeds the base
     */
    public function of(Money $base): Money
    {
        if ($this->type === DiscountType::Percent) {
            return $base->percent($this->value);
        }

        $amount = Money::of($this->value, $base->currency);
        if ($amount->greaterThan($base)) {
            throw new BusinessRuleViolation('DISCOUNT_NOT_ALLOWED', "A discount of {$this->value} is more than the amount it applies to ({$base->amount()}).", [
                'discount' => $this->value,
                'amount' => $base->amount(),
            ]);
        }

        return $amount;
    }

    /**
     * The discount expressed as a percentage of $base (for limit checks), 4 decimals.
     */
    public function percentOf(Money $base): string
    {
        if ($this->type === DiscountType::Percent) {
            return Decimal::round($this->value, 4);
        }
        if ($base->isZero()) {
            return $this->isZero() ? '0.0000' : '100.0000';
        }

        return Decimal::div(Decimal::mul($this->value, '100', 6), $base->amount(), 4);
    }

    public function equals(?self $other): bool
    {
        return $other !== null && $other->type === $this->type && Decimal::compare($other->value, $this->value) === 0;
    }
}
