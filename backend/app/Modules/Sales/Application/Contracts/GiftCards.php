<?php

namespace App\Modules\Sales\Application\Contracts;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * POS1b: what Sales needs from gift cards / vouchers / credit notes, so a sale can be paid
 * with one and a return refunded as a new credit note. Declared here and implemented by the
 * StoredValue module. Every method runs inside the caller's sale/return transaction.
 * Full codes never leave this boundary except in issueCreditNote()'s result (shown once).
 */
interface GiftCards
{
    /**
     * Spends $amount from the card with this code (under a row lock).
     *
     * @return array{gift_card_id: string, code_last4: string, balance_after: string}
     *
     * @throws BusinessRuleViolation GIFT_CARD_INVALID (details.reason: not_found|void|expired|insufficient|wrong_currency; details.balance when known)
     */
    public function redeem(string $code, string $amount, string $currency, string $saleId, string $saleNumber): array;

    /**
     * The sale was cancelled: gives back what it spent from gift cards. Idempotent.
     */
    public function reverseSale(string $saleId): void;

    /**
     * Issues a credit note (a gift card of kind credit_note) for a refund of a return.
     *
     * @return array{id: string, code: string, code_last4: string, expires_at: ?string}
     */
    public function issueCreditNote(string $amount, string $currency, ?string $customerId, string $returnId, string $returnNumber, string $createdBy): array;
}
