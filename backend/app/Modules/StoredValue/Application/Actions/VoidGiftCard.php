<?php

namespace App\Modules\StoredValue\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\StoredValue\Application\Services\GiftCardBook;
use App\Modules\StoredValue\Domain\GiftCardEntryType;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * POS1b: voids a gift card, voucher or credit note (lost, stolen, issued by mistake). The
 * remaining balance is written off with a `void` entry; the card can no longer be spent.
 */
class VoidGiftCard
{
    public function __construct(
        private readonly GiftCardBook $book,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, string $giftCardId, string $reason): GiftCard
    {
        $reason = trim($reason);

        return DB::transaction(function () use ($actor, $giftCardId, $reason) {
            $card = $this->book->lock($giftCardId) ?? throw new NotFoundHttpException('Gift card not found.');
            if ($card->status === GiftCard::VOID) {
                throw new BusinessRuleViolation('GIFT_CARD_INVALID', "Gift card ••••{$card->code_last4} is already void.", ['reason' => 'void', 'code_last4' => $card->code_last4, 'balance' => (string) $card->balance]);
            }

            $actorId = (string) $actor->getAuthIdentifier();
            $writtenOff = (string) $card->balance;
            $card->status = GiftCard::VOID;
            $card->void_reason = $reason;
            $card->voided_by = $actorId;
            $card->voided_at = now();
            $this->book->post($card, GiftCardEntryType::Void, Decimal::negate($writtenOff, 2), $actorId);

            $this->audit->record('gift_card.voided', $card, old: ['status' => GiftCard::ACTIVE, 'balance' => $writtenOff], new: [
                'status' => GiftCard::VOID,
                'balance' => '0.00',
                'kind' => $card->kind->value,
                'code_last4' => $card->code_last4,
                'reason' => $reason,
            ]);

            return $card;
        });
    }
}
