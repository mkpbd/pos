<?php

namespace App\Modules\Shared\Domain\ValueObjects;

use BCMath\Number;
use InvalidArgumentException;
use JsonSerializable;
use RoundingMode;
use Stringable;

/**
 * Immutable monetary amount backed by arbitrary-precision decimals.
 *
 * - Floats are rejected at the boundary; amounts enter as numeric strings or ints.
 * - Stored at currency scale (2). Multiplication rounds half away from zero,
 *   matching per-line rounding on printed invoices.
 * - allocate() splits an amount by ratios without losing or creating cents,
 *   used to spread invoice-level discounts across lines.
 */
final class Money implements JsonSerializable, Stringable
{
    public const SCALE = 2;

    private const ROUNDING = RoundingMode::HalfAwayFromZero;

    private function __construct(
        private readonly Number $amount,
        public readonly string $currency,
    ) {}

    public static function of(string|int $amount, string $currency): self
    {
        $number = self::parse($amount);

        if ($number->scale > self::SCALE && $number->round(self::SCALE, self::ROUNDING)->compare($number) !== 0) {
            throw new InvalidArgumentException("Amount [{$amount}] has more than ".self::SCALE.' decimal places.');
        }

        return new self(self::normalize($number), self::currencyCode($currency));
    }

    /**
     * Line amount = quantity × unit price, rounded once to currency scale.
     * Both factors may carry more decimals than money (e.g. 1.250 kg × 33.3333).
     */
    public static function ofProduct(string $quantity, string $unitPrice, string $currency): self
    {
        return new self(self::normalize(self::parse($quantity)->mul(self::parse($unitPrice))), self::currencyCode($currency));
    }

    public static function zero(string $currency): self
    {
        return new self(new Number('0'), self::currencyCode($currency));
    }

    public function plus(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount->add($other->amount), $this->currency);
    }

    public function minus(self $other): self
    {
        $this->assertSameCurrency($other);

        return new self($this->amount->sub($other->amount), $this->currency);
    }

    /**
     * Multiply by a quantity or factor, rounding the result to currency scale.
     */
    public function times(string|int $multiplier): self
    {
        return new self(self::normalize($this->amount->mul(self::parse($multiplier))), $this->currency);
    }

    /**
     * Percentage of this amount, e.g. percent('15') for 15 % VAT.
     */
    public function percent(string|int $rate): self
    {
        return new self(
            self::normalize($this->amount->mul(self::parse($rate))->div(100, self::SCALE + 6)),
            $this->currency,
        );
    }

    public function negate(): self
    {
        return new self($this->amount->mul(-1), $this->currency);
    }

    /**
     * Split into parts proportional to $ratios using the largest-remainder method.
     * The parts always sum exactly to this amount.
     *
     * @param  list<string|int>  $ratios
     * @return list<self>
     */
    public function allocate(array $ratios): array
    {
        if ($ratios === []) {
            throw new InvalidArgumentException('At least one ratio is required.');
        }

        $parsed = array_map(self::parse(...), $ratios);
        $total = array_reduce($parsed, fn (Number $carry, Number $r) => $carry->add($r), new Number('0'));

        foreach ($parsed as $ratio) {
            if ($ratio->compare(0) < 0) {
                throw new InvalidArgumentException('Ratios must not be negative.');
            }
        }

        if ($total->compare(0) === 0) {
            throw new InvalidArgumentException('Ratios must not all be zero.');
        }

        $sign = $this->amount->compare(0) < 0 ? -1 : 1;
        $cents = $this->amount->mul(100 * $sign);

        $shares = [];
        $remainders = [];
        $allocated = new Number('0');

        foreach ($parsed as $i => $ratio) {
            $exact = $cents->mul($ratio)->div($total, 12);
            $floor = $exact->floor();
            $shares[$i] = $floor;
            $remainders[$i] = $exact->sub($floor);
            $allocated = $allocated->add($floor);
        }

        // Hand out leftover cents to the largest fractional remainders (stable on ties).
        $leftover = (int) (string) $cents->sub($allocated);
        $order = array_keys($remainders);
        usort($order, fn (int $a, int $b) => $remainders[$b]->compare($remainders[$a]) ?: $a <=> $b);

        foreach (array_slice($order, 0, $leftover) as $i) {
            $shares[$i] = $shares[$i]->add(1);
        }

        return array_map(
            fn (Number $share) => new self($share->mul($sign)->div(100, self::SCALE), $this->currency),
            $shares,
        );
    }

    public function compareTo(self $other): int
    {
        $this->assertSameCurrency($other);

        return $this->amount->compare($other->amount);
    }

    public function equals(self $other): bool
    {
        return $this->currency === $other->currency && $this->amount->compare($other->amount) === 0;
    }

    public function greaterThan(self $other): bool
    {
        return $this->compareTo($other) > 0;
    }

    public function lessThan(self $other): bool
    {
        return $this->compareTo($other) < 0;
    }

    public function isZero(): bool
    {
        return $this->amount->compare(0) === 0;
    }

    public function isNegative(): bool
    {
        return $this->amount->compare(0) < 0;
    }

    public function isPositive(): bool
    {
        return $this->amount->compare(0) > 0;
    }

    /**
     * Fixed two-decimal string, safe to persist into a NUMERIC column.
     */
    public function amount(): string
    {
        return bcadd((string) $this->amount, '0', self::SCALE);
    }

    public function jsonSerialize(): array
    {
        return ['amount' => $this->amount(), 'currency' => $this->currency];
    }

    public function __toString(): string
    {
        return $this->amount().' '.$this->currency;
    }

    private static function parse(string|int $value): Number
    {
        if (is_string($value) && ! preg_match('/^-?\d+(\.\d+)?$/', $value)) {
            throw new InvalidArgumentException("[{$value}] is not a valid decimal number.");
        }

        return new Number($value);
    }

    private static function normalize(Number $number): Number
    {
        return $number->round(self::SCALE, self::ROUNDING);
    }

    private static function currencyCode(string $currency): string
    {
        if (! preg_match('/^[A-Z]{3}$/', $currency)) {
            throw new InvalidArgumentException("[{$currency}] is not an ISO 4217 currency code.");
        }

        return $currency;
    }

    private function assertSameCurrency(self $other): void
    {
        if ($this->currency !== $other->currency) {
            throw new InvalidArgumentException("Currency mismatch: {$this->currency} vs {$other->currency}.");
        }
    }
}
