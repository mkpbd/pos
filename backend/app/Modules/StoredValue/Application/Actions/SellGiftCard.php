<?php

namespace App\Modules\StoredValue\Application\Actions;

use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\StoredValue\Application\Services\GiftCardBook;
use App\Modules\StoredValue\Application\Services\GiftCardContext;
use App\Modules\StoredValue\Domain\GiftCardCode;
use App\Modules\StoredValue\Domain\GiftCardKind;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * POS1b: a gift card sold at the till. Not a sale (no tax, no stock, not in sales reports):
 * the money goes into the payments ledger (cash into the seller's open drawer in the store's
 * branch) as a `gift_card_sale` with receipt number GCS-000001, and the card is issued for
 * the amount. The full code is returned once and never stored or audited.
 */
class SellGiftCard
{
    public function __construct(
        private readonly GiftCardContext $context,
        private readonly StoreAccess $stores,
        private readonly GiftCardBook $book,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{store_id: string, amount: string|int, payments: list<array{method: string, amount: string|int, reference?: ?string}>, customer_id?: ?string, code?: ?string, expires_at?: ?string, never_expires?: bool}  $data
     * @return array{card: GiftCard, code: GiftCardCode}
     */
    public function __invoke(TenantUser $actor, array $data): array
    {
        $store = $this->stores->require($actor, $data['store_id']);
        $currency = $this->context->currency();
        $amount = Money::of((string) $data['amount'], $currency);
        $paid = Money::zero($currency);
        foreach ($data['payments'] as $payment) {
            $paid = $paid->plus(Money::of((string) $payment['amount'], $currency));
        }
        if (! $paid->equals($amount)) {
            throw ValidationException::withMessages(['payments' => ["The payments add up to {$paid->amount()}; they must equal the card amount {$amount->amount()}."]]);
        }
        $customer = $this->context->customer($data['customer_id'] ?? null);
        $code = filled($data['code'] ?? null) ? GiftCardCode::prePrinted((string) $data['code']) : null;
        $expiresAt = $this->context->expiry($data);

        return DB::transaction(function () use ($actor, $store, $currency, $amount, $data, $customer, $code, $expiresAt) {
            $organizationId = $this->context->organizationId();
            $receipt = $this->sequences->next($organizationId, 'gift_card_sale', 'GCS-');
            $actorId = (string) $actor->getAuthIdentifier();

            $issued = $this->book->issue(
                GiftCardKind::GiftCard,
                $amount->amount(),
                $currency,
                $expiresAt,
                $actorId,
                ['customer_id' => $customer['id'] ?? null, 'sale_receipt_number' => $receipt],
                $code,
                ['type' => 'gift_card_sale', 'number' => $receipt],
            );
            $card = $issued['card'];

            $this->payments->record($actor, $store['branch_id'], array_map(fn (array $p) => new LedgerEntry(
                PaymentDirection::In,
                PaymentMethod::from($p['method']),
                Money::of((string) $p['amount'], $currency)->amount(),
                $customer['id'] ?? null,
                filled($p['reference'] ?? null) ? trim((string) $p['reference']) : null,
                "Gift card ••••{$card->code_last4} sold",
            ), $data['payments']), new PaymentSource(PaymentSource::GIFT_CARD_SALE, $card->id, $receipt));

            $this->audit->record('gift_card.sold', $card, new: [
                'receipt_number' => $receipt,
                'kind' => $card->kind->value,
                'code_last4' => $card->code_last4,
                'amount' => $amount->amount(),
                'methods' => array_values(array_unique(array_column($data['payments'], 'method'))),
                'customer_id' => $card->customer_id,
                'expires_at' => $card->expires_at?->toIso8601String(),
                'store_id' => $store['id'],
                'pre_printed' => $code !== null,
            ]);

            return $issued;
        });
    }
}
