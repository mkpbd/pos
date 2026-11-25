<?php

namespace App\Modules\StoredValue\Application\Services;

use App\Modules\Sales\Application\Contracts\GiftCards;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\StoredValue\Domain\GiftCardCode;
use App\Modules\StoredValue\Domain\GiftCardEntryType;
use App\Modules\StoredValue\Domain\GiftCardKind;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use App\Modules\StoredValue\Infrastructure\Models\GiftCardEntry;
use InvalidArgumentException;

/**
 * Gift cards as Sales sees them: spending one at the till, giving back what a cancelled sale
 * spent and issuing a credit note as the refund of a return. Runs inside the caller's
 * transaction; cards are locked before their balance changes.
 */
class EloquentGiftCards implements GiftCards
{
    public const REFERENCE_SALE = 'sale';

    public const REFERENCE_RETURN = 'sale_return';

    public function __construct(
        private readonly GiftCardBook $book,
        private readonly AuditTrail $audit,
    ) {}

    public function redeem(string $code, string $amount, string $currency, string $saleId, string $saleNumber): array
    {
        if (Decimal::compare($amount, '0') <= 0) {
            throw new InvalidArgumentException('A gift card is redeemed for a positive amount.');
        }

        $card = trim($code) === '' ? null : $this->book->lockByCode($code);
        if ($card === null) {
            // The last 4 of the code given, so the till shows the refusal on the right tender.
            $given = substr(GiftCardCode::normalise($code), -4);

            throw $this->invalid('not_found', 'No gift card has this code.', last4: $given === '' ? null : $given);
        }
        if (($reason = $card->unusableReason()) !== null) {
            throw $this->invalid($reason, $reason === 'void'
                ? "Gift card ••••{$card->code_last4} has been voided."
                : "Gift card ••••{$card->code_last4} expired on {$card->expires_at?->toDateString()}.", $card);
        }
        if ($card->currency !== $currency) {
            throw $this->invalid('wrong_currency', "Gift card ••••{$card->code_last4} is in {$card->currency}.", $card);
        }
        if (Decimal::compare($amount, (string) $card->balance) > 0) {
            throw $this->invalid('insufficient', "Gift card ••••{$card->code_last4} holds {$card->balance}; it cannot pay ".Decimal::round($amount, 2).'.', $card);
        }

        $entry = $this->book->post($card, GiftCardEntryType::Redeem, Decimal::negate($amount, 2), StaffActor::id(), [
            'type' => self::REFERENCE_SALE, 'id' => $saleId, 'number' => $saleNumber,
        ]);

        return ['gift_card_id' => $card->id, 'code_last4' => $card->code_last4, 'balance_after' => (string) $entry->balance_after];
    }

    public function reverseSale(string $saleId): void
    {
        // Net still spent per card: redemptions (−) plus reversals already given back (+).
        $net = GiftCardEntry::query()
            ->where('reference_type', self::REFERENCE_SALE)
            ->where('reference_id', $saleId)
            ->whereIn('type', [GiftCardEntryType::Redeem->value, GiftCardEntryType::SaleReversal->value])
            ->groupBy('gift_card_id')
            ->selectRaw('gift_card_id, MIN(reference_number) as reference_number')
            ->pluck('reference_number', 'gift_card_id');

        foreach ($net->keys()->sort()->values() as $giftCardId) {
            $card = $this->book->lock((string) $giftCardId);
            if ($card === null) {
                continue;
            }
            // Re-read under the lock so two cancellations cannot both give the money back.
            $spent = Decimal::negate((string) GiftCardEntry::query()
                ->where('gift_card_id', $card->id)
                ->where('reference_type', self::REFERENCE_SALE)
                ->where('reference_id', $saleId)
                ->whereIn('type', [GiftCardEntryType::Redeem->value, GiftCardEntryType::SaleReversal->value])
                ->sum('amount'), 2);
            if (Decimal::compare($spent, '0') <= 0) {
                continue;
            }

            // Given back even when the card has since expired or been voided (shown in its history).
            $this->book->post($card, GiftCardEntryType::SaleReversal, $spent, StaffActor::id(), [
                'type' => self::REFERENCE_SALE, 'id' => $saleId, 'number' => $net[$giftCardId],
            ]);
            $this->audit->record('gift_card.sale_reversed', $card, new: [
                'code_last4' => $card->code_last4,
                'amount' => $spent,
                'balance' => (string) $card->balance,
                'sale_number' => $net[$giftCardId],
            ]);
        }
    }

    public function issueCreditNote(string $amount, string $currency, ?string $customerId, string $returnId, string $returnNumber, string $createdBy): array
    {
        ['card' => $card, 'code' => $code] = $this->book->issue(
            GiftCardKind::CreditNote,
            $amount,
            $currency,
            $this->book->defaultExpiry(),
            $createdBy,
            ['customer_id' => $customerId, 'source_return_id' => $returnId, 'note' => "Refund of return {$returnNumber}"],
            reference: ['type' => self::REFERENCE_RETURN, 'id' => $returnId, 'number' => $returnNumber],
        );

        $this->audit->record('gift_card.credit_note_issued', $card, new: [
            'kind' => $card->kind->value,
            'code_last4' => $card->code_last4,
            'amount' => (string) $card->initial_value,
            'customer_id' => $customerId,
            'return_number' => $returnNumber,
        ]);

        return [
            'id' => $card->id,
            'code' => $code->formatted(),
            'code_last4' => $card->code_last4,
            'expires_at' => $card->expires_at?->toIso8601String(),
        ];
    }

    /**
     * GIFT_CARD_INVALID with `details.reason`, `details.code_last4` (the card's, or the last 4 of
     * the code given when no card has it) and `details.balance` when the card is known.
     */
    private function invalid(string $reason, string $message, ?GiftCard $card = null, ?string $last4 = null): BusinessRuleViolation
    {
        return new BusinessRuleViolation('GIFT_CARD_INVALID', $message, array_filter([
            'reason' => $reason,
            'code_last4' => $card?->code_last4 ?? $last4,
            'balance' => $card === null ? null : (string) $card->balance,
        ], fn ($v) => $v !== null));
    }
}
