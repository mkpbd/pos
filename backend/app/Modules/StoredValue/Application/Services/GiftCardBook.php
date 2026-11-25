<?php

namespace App\Modules\StoredValue\Application\Services;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\StoredValue\Domain\GiftCardCode;
use App\Modules\StoredValue\Domain\GiftCardEntryType;
use App\Modules\StoredValue\Domain\GiftCardKind;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use App\Modules\StoredValue\Infrastructure\Models\GiftCardEntry;
use DateTimeInterface;
use Illuminate\Validation\ValidationException;
use LogicException;
use RuntimeException;

/**
 * Writes gift cards and their balance movements. Callers run inside a DB transaction; every
 * balance change goes through post() on a card locked with lock()/lockByCode().
 */
class GiftCardBook
{
    /** Default lifetime of a new card, voucher or credit note. */
    public const DEFAULT_VALIDITY_MONTHS = 12;

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Creates a card with its `issue` entry. A generated code is used unless $code (a
     * pre-printed number) is given; the code is returned to be shown once and never stored.
     *
     * @param  array{customer_id?: ?string, sale_receipt_number?: ?string, source_return_id?: ?string, note?: ?string}  $attributes
     * @param  array{type?: ?string, id?: ?string, number?: ?string}  $reference
     * @return array{card: GiftCard, code: GiftCardCode}
     *
     * @throws ValidationException code (a pre-printed number already in use)
     */
    public function issue(
        GiftCardKind $kind,
        string $amount,
        string $currency,
        ?DateTimeInterface $expiresAt,
        ?string $issuedBy,
        array $attributes = [],
        ?GiftCardCode $code = null,
        array $reference = [],
    ): array {
        if (Decimal::compare($amount, '0') <= 0) {
            throw new LogicException('A gift card is issued for a positive amount.');
        }

        if ($code !== null) {
            if ($this->exists($code)) {
                throw ValidationException::withMessages(['code' => ['This card number is already in use.']]);
            }
        } else {
            $code = $this->freshCode();
        }

        $now = now();
        $amount = Decimal::round($amount, 2);
        $card = GiftCard::query()->create([
            'organization_id' => $this->tenant->requireOrganization(),
            'code_hash' => $code->hash(),
            'code_last4' => $code->last4(),
            'kind' => $kind,
            'initial_value' => $amount,
            'balance' => '0.00',
            'currency' => $currency,
            'status' => GiftCard::ACTIVE,
            'expires_at' => $expiresAt,
            'customer_id' => $attributes['customer_id'] ?? null,
            'issued_by' => $issuedBy,
            'issued_at' => $now,
            'sale_receipt_number' => $attributes['sale_receipt_number'] ?? null,
            'source_return_id' => $attributes['source_return_id'] ?? null,
            'note' => $attributes['note'] ?? null,
        ]);
        $this->post($card, GiftCardEntryType::Issue, $amount, $issuedBy, $reference);

        return ['card' => $card, 'code' => $code];
    }

    /** The card with this id, locked until the transaction ends. */
    public function lock(string $giftCardId): ?GiftCard
    {
        return GiftCard::query()->whereKey($giftCardId)->lockForUpdate()->first();
    }

    /** The card with this code (any formatting), locked until the transaction ends. */
    public function lockByCode(string $code): ?GiftCard
    {
        return GiftCard::query()->where('code_hash', GiftCardCode::hashOf($code))->lockForUpdate()->first();
    }

    /**
     * Moves the (locked) card's balance by $delta and writes the entry.
     *
     * @param  array{type?: ?string, id?: ?string, number?: ?string}  $reference
     */
    public function post(GiftCard $card, GiftCardEntryType $type, string $delta, ?string $createdBy, array $reference = []): GiftCardEntry
    {
        $balance = Decimal::add((string) $card->balance, $delta, 2);
        if (Decimal::isNegative($balance)) {
            throw new LogicException('A gift card balance cannot go below zero.');
        }
        $card->balance = $balance;
        $card->save();

        return GiftCardEntry::query()->create([
            'organization_id' => $card->organization_id,
            'gift_card_id' => $card->id,
            'type' => $type,
            'amount' => Decimal::round($delta, 2),
            'balance_after' => $balance,
            'reference_type' => $reference['type'] ?? null,
            'reference_id' => $reference['id'] ?? null,
            'reference_number' => $reference['number'] ?? null,
            'created_by' => $createdBy,
            'created_at' => now(),
        ]);
    }

    /** The default expiry of a new card: 12 months from now. */
    public function defaultExpiry(): DateTimeInterface
    {
        return now()->addMonths(self::DEFAULT_VALIDITY_MONTHS);
    }

    private function exists(GiftCardCode $code): bool
    {
        return GiftCard::query()->where('code_hash', $code->hash())->exists();
    }

    private function freshCode(): GiftCardCode
    {
        // 32^16 codes: a collision is practically impossible, but never reuse one.
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $code = GiftCardCode::generate();
            if (! $this->exists($code)) {
                return $code;
            }
        }

        throw new RuntimeException('Could not generate a unique gift card code.');
    }
}
