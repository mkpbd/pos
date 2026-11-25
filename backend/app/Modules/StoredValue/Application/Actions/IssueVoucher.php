<?php

namespace App\Modules\StoredValue\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\StoredValue\Application\Services\GiftCardBook;
use App\Modules\StoredValue\Application\Services\GiftCardContext;
use App\Modules\StoredValue\Domain\GiftCardCode;
use App\Modules\StoredValue\Domain\GiftCardKind;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use Illuminate\Support\Facades\DB;

/**
 * POS1b: a voucher a manager gives away (a goodwill gesture, a prize). No money moves; the
 * reason is kept as the card's note. The full code is returned once and never stored.
 */
class IssueVoucher
{
    public function __construct(
        private readonly GiftCardContext $context,
        private readonly GiftCardBook $book,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{amount: string|int, reason: string, customer_id?: ?string, expires_at?: ?string, never_expires?: bool}  $data
     * @return array{card: GiftCard, code: GiftCardCode}
     */
    public function __invoke(TenantUser $actor, array $data): array
    {
        $currency = $this->context->currency();
        $amount = Money::of((string) $data['amount'], $currency);
        $customer = $this->context->customer($data['customer_id'] ?? null);
        $expiresAt = $this->context->expiry($data);
        $reason = trim($data['reason']);

        return DB::transaction(function () use ($actor, $amount, $currency, $customer, $expiresAt, $reason) {
            $issued = $this->book->issue(
                GiftCardKind::Voucher,
                $amount->amount(),
                $currency,
                $expiresAt,
                (string) $actor->getAuthIdentifier(),
                ['customer_id' => $customer['id'] ?? null, 'note' => $reason],
            );
            $card = $issued['card'];

            $this->audit->record('gift_card.voucher_issued', $card, new: [
                'kind' => $card->kind->value,
                'code_last4' => $card->code_last4,
                'amount' => $amount->amount(),
                'reason' => $reason,
                'customer_id' => $card->customer_id,
                'expires_at' => $card->expires_at?->toIso8601String(),
            ]);

            return $issued;
        });
    }
}
