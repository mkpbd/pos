<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Sales\Application\Contracts\GiftCards;
use App\Modules\Sales\Application\Contracts\StoreCredit;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Validation\ValidationException;

/**
 * POS1b: paying a sale and refunding a return with stored value — the sale customer's store
 * credit and gift cards / vouchers / credit notes (StoredValue module, through the StoreCredit
 * and GiftCards contracts). Runs inside the caller's sale/return transaction. A gift card is
 * tendered with its full code in `reference`; the code is spent here and only "Gift card ••••1234"
 * is kept on the payment row.
 */
class StoredValueTenders
{
    public function __construct(
        private readonly StoreCredit $storeCredit,
        private readonly GiftCards $giftCards,
    ) {}

    /**
     * Checks the tendered payments before anything is written.
     *
     * @param  list<array{method: string, amount: string|int|float, reference?: ?string}>  $payments
     * @param  array<string, mixed>|null  $customer
     *
     * @throws ValidationException|BusinessRuleViolation CUSTOMER_REQUIRED
     */
    public function assertTenders(array $payments, ?array $customer): void
    {
        $errors = [];
        $storeCredit = false;
        foreach (array_values($payments) as $i => $payment) {
            $method = PaymentMethod::tryFrom((string) $payment['method']);
            if ($method === PaymentMethod::GiftCard && blank($payment['reference'] ?? null)) {
                $errors["payments.{$i}.reference"] = ['Enter or scan the gift card code.'];
            }
            $storeCredit = $storeCredit || $method === PaymentMethod::StoreCredit;
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        if ($storeCredit && $customer === null) {
            throw new BusinessRuleViolation('CUSTOMER_REQUIRED', 'Choose the customer whose store credit pays for the sale.');
        }
    }

    /**
     * Spends the store credit and gift cards of the settled payments and returns the payments
     * with gift card references masked.
     *
     * @param  list<array{method: PaymentMethod, amount: string, tendered: ?string, reference: ?string}>  $payments
     * @return list<array{method: PaymentMethod, amount: string, tendered: ?string, reference: ?string}>
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STORE_CREDIT, GIFT_CARD_INVALID
     */
    public function spend(array $payments, ?string $customerId, string $currency, string $saleId, string $saleNumber): array
    {
        $storeCredit = '0.00';
        foreach ($payments as $i => $payment) {
            if ($payment['method'] === PaymentMethod::StoreCredit) {
                $storeCredit = Decimal::add($storeCredit, $payment['amount'], 2);
                $payments[$i]['reference'] = null;
            } elseif ($payment['method'] === PaymentMethod::GiftCard) {
                $redeemed = $this->giftCards->redeem((string) $payment['reference'], $payment['amount'], $currency, $saleId, $saleNumber);
                $payments[$i]['reference'] = self::giftCardReference($redeemed['code_last4']);
            }
        }
        if (! Decimal::isZero($storeCredit)) {
            if ($customerId === null) {
                throw new BusinessRuleViolation('CUSTOMER_REQUIRED', 'Choose the customer whose store credit pays for the sale.');
            }
            $this->storeCredit->spend($customerId, $storeCredit, $saleId, $saleNumber);
        }

        return $payments;
    }

    /**
     * A cancelled sale gives back the store credit and gift card value it spent.
     *
     * @param  iterable<PaymentMethod>  $methods  the methods the sale was paid with
     */
    public function reverseSale(string $saleId, iterable $methods): void
    {
        $used = [];
        foreach ($methods as $method) {
            $used[$method->value] = true;
        }
        if (isset($used[PaymentMethod::StoreCredit->value])) {
            $this->storeCredit->reverseSale($saleId);
        }
        if (isset($used[PaymentMethod::GiftCard->value])) {
            $this->giftCards->reverseSale($saleId);
        }
    }

    /**
     * Refunds of a return made in stored value: store credit for the sale's customer, a new
     * credit note for gift card refunds. Returns the refunds (credit note references masked)
     * and the credit note issued, if any (its full code is shown once).
     *
     * @param  list<array{method: PaymentMethod, amount: string, reference: ?string}>  $refunds
     * @return array{refunds: list<array{method: PaymentMethod, amount: string, reference: ?string}>, credit_note: array{code: string, code_last4: string, amount: string, expires_at: ?string}|null}
     *
     * @throws BusinessRuleViolation CUSTOMER_REQUIRED
     */
    public function refund(array $refunds, ?string $customerId, string $currency, string $returnId, string $returnNumber, string $actorId): array
    {
        $storeCredit = '0.00';
        $giftCard = '0.00';
        foreach ($refunds as $i => $refund) {
            if ($refund['method'] === PaymentMethod::StoreCredit) {
                $storeCredit = Decimal::add($storeCredit, $refund['amount'], 2);
                $refunds[$i]['reference'] = null;
            } elseif ($refund['method'] === PaymentMethod::GiftCard) {
                $giftCard = Decimal::add($giftCard, $refund['amount'], 2);
            }
        }

        if (! Decimal::isZero($storeCredit)) {
            if ($customerId === null) {
                throw new BusinessRuleViolation('CUSTOMER_REQUIRED', 'Only a sale with a customer can be refunded to store credit.');
            }
            $this->storeCredit->refund($customerId, $storeCredit, $returnId, $returnNumber);
        }

        $creditNote = null;
        if (! Decimal::isZero($giftCard)) {
            // One credit note for the whole gift card refund, even when it was split over lines.
            $issued = $this->giftCards->issueCreditNote($giftCard, $currency, $customerId, $returnId, $returnNumber, $actorId);
            $creditNote = ['code' => $issued['code'], 'code_last4' => $issued['code_last4'], 'amount' => $giftCard, 'expires_at' => $issued['expires_at']];
            foreach ($refunds as $i => $refund) {
                if ($refund['method'] === PaymentMethod::GiftCard) {
                    $refunds[$i]['reference'] = 'Credit note ••••'.$issued['code_last4'];
                }
            }
        }

        return ['refunds' => $refunds, 'credit_note' => $creditNote];
    }

    public static function giftCardReference(string $last4): string
    {
        return 'Gift card ••••'.$last4;
    }

    /**
     * The last 4 characters of the gift card / credit note a payment or refund row names.
     */
    public static function giftCardLast4(PaymentMethod $method, ?string $reference): ?string
    {
        if ($method !== PaymentMethod::GiftCard || $reference === null) {
            return null;
        }

        return preg_match('/••••([A-Z0-9]{4})$/u', $reference, $m) === 1 ? $m[1] : null;
    }
}
