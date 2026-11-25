<?php

namespace App\Modules\StoredValue\Application\Queries;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\StoredValue\Domain\GiftCardCode;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use App\Modules\StoredValue\Infrastructure\Models\GiftCardEntry;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Reads of gift cards, vouchers and credit notes: the list, one card with its history and the
 * till's balance lookup by code. Never returns a code — only its last 4 characters.
 */
class GiftCardQueries
{
    public const STATUSES = ['active', 'expired', 'void'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CustomerDirectory $customers,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Filters: `search` (the last 4 characters, or a customer's name / code / phone), `status`
     * (`active` = spendable, `expired`, `void`), `kind`.
     *
     * @param  array{search?: ?string, status?: ?string, kind?: ?string}  $filters
     * @return Builder<GiftCard>
     */
    public function query(array $filters): Builder
    {
        $organizationId = $this->tenant->requireOrganization();
        $query = GiftCard::query()
            ->when($filters['kind'] ?? null, fn (Builder $q, string $kind) => $q->where('kind', $kind))
            ->when($filters['status'] ?? null, fn (Builder $q, string $status) => match ($status) {
                'void' => $q->where('status', GiftCard::VOID),
                'expired' => $q->where('status', GiftCard::ACTIVE)->whereNotNull('expires_at')->where('expires_at', '<=', now()),
                default => $q->where('status', GiftCard::ACTIVE)->where(fn (Builder $e) => $e->whereNull('expires_at')->orWhere('expires_at', '>', now())),
            });

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $like = '%'.addcslashes($search, '%_\\').'%';
            $last4 = substr(GiftCardCode::normalise($search), -4);
            $query->where(function (Builder $q) use ($like, $last4, $organizationId) {
                $q->where('code_last4', $last4)
                    // Read-only lookup of the customer names the list shows.
                    ->orWhereIn('customer_id', DB::table('customers')->where('organization_id', $organizationId)
                        ->where(fn ($c) => $c->whereLike('name', $like)->orWhereLike('code', $like)->orWhereLike('phone', $like))
                        ->select('id'));
            });
        }

        return $query->orderByDesc('issued_at')->orderByDesc('id');
    }

    /**
     * @param  iterable<GiftCard>  $cards
     * @return list<array<string, mixed>>
     */
    public function present(iterable $cards): array
    {
        $cards = collect($cards);
        $organizationId = $this->tenant->requireOrganization();
        $customers = $this->customers->summaries($organizationId, $cards->pluck('customer_id')->filter()->unique()->values()->all());
        $users = $this->users->names($organizationId, $cards->pluck('issued_by')->filter()->unique()->values()->all());

        return $cards->map(fn (GiftCard $card) => [
            'id' => $card->id,
            'code_last4' => $card->code_last4,
            'kind' => $card->kind->value,
            'kind_label' => $card->kind->label(),
            'initial_value' => (string) $card->initial_value,
            'balance' => (string) $card->balance,
            'currency' => $card->currency,
            'status' => $card->status,
            'expires_at' => $card->expires_at?->toIso8601String(),
            'expired' => $card->isExpired(),
            'customer' => $card->customer_id !== null && isset($customers[$card->customer_id])
                ? ['id' => $card->customer_id, 'name' => $customers[$card->customer_id]['name']]
                : null,
            'issued_by' => $card->issued_by === null ? null : ['id' => $card->issued_by, 'name' => $users[$card->issued_by] ?? null],
            'issued_at' => $card->issued_at->toIso8601String(),
            'sale_receipt_number' => $card->sale_receipt_number,
        ])->values()->all();
    }

    /**
     * One card with its history (newest first).
     *
     * @return array<string, mixed>
     */
    public function detail(string $giftCardId): array
    {
        $card = GiftCard::query()->find($giftCardId) ?? throw new NotFoundHttpException('Gift card not found.');
        $entries = GiftCardEntry::query()->where('gift_card_id', $card->id)->orderByDesc('created_at')->orderByDesc('id')->get();
        $organizationId = $this->tenant->requireOrganization();
        $users = $this->users->names($organizationId, $entries->pluck('created_by')->push($card->voided_by)->filter()->unique()->values()->all());

        return $this->present([$card])[0] + [
            'note' => $card->note,
            'source_return_id' => $card->source_return_id,
            'void_reason' => $card->void_reason,
            'voided_by' => $card->voided_by === null ? null : ['id' => $card->voided_by, 'name' => $users[$card->voided_by] ?? null],
            'voided_at' => $card->voided_at?->toIso8601String(),
            'entries' => $entries->map(fn (GiftCardEntry $e) => [
                'id' => $e->id,
                'type' => $e->type->value,
                'amount' => (string) $e->amount,
                'balance_after' => (string) $e->balance_after,
                'reference_type' => $e->reference_type,
                'reference_id' => $e->reference_id,
                'reference_number' => $e->reference_number,
                'created_by' => $e->created_by === null ? null : ['id' => $e->created_by, 'name' => $users[$e->created_by] ?? null],
                'created_at' => $e->created_at->toIso8601String(),
            ])->values()->all(),
        ];
    }

    /**
     * The till's balance check. An unknown code is not an error: `usable: false, reason: not_found`.
     *
     * @return array{id: ?string, code_last4: ?string, kind: ?string, balance: ?string, currency: ?string, status: ?string, expires_at: ?string, usable: bool, reason: ?string}
     */
    public function lookup(string $code): array
    {
        $card = GiftCard::query()->where('code_hash', GiftCardCode::hashOf($code))->first();
        if ($card === null) {
            return [
                'id' => null, 'code_last4' => null, 'kind' => null, 'balance' => null, 'currency' => null,
                'status' => null, 'expires_at' => null, 'usable' => false, 'reason' => 'not_found',
            ];
        }
        $reason = $card->unusableReason();

        return [
            'id' => $card->id,
            'code_last4' => $card->code_last4,
            'kind' => $card->kind->value,
            'balance' => (string) $card->balance,
            'currency' => $card->currency,
            'status' => $card->status,
            'expires_at' => $card->expires_at?->toIso8601String(),
            'usable' => $reason === null,
            'reason' => $reason,
        ];
    }

    /**
     * The response of a sale / voucher: the card with its full code (shown this once).
     *
     * @return array<string, mixed>
     */
    public function issued(GiftCard $card, GiftCardCode $code): array
    {
        $row = $this->present([$card])[0];

        return [
            'id' => $card->id,
            'code' => $code->formatted(),
            'code_last4' => $card->code_last4,
            'kind' => $row['kind'],
            'kind_label' => $row['kind_label'],
            'initial_value' => $row['initial_value'],
            'balance' => $row['balance'],
            'currency' => $card->currency,
            'expires_at' => $row['expires_at'],
            'customer' => $row['customer'],
            'issued_at' => $row['issued_at'],
        ];
    }
}
