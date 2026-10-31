<?php

namespace App\Modules\Payments\Infrastructure\Ledger;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Application\Services\DrawerCash;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

class EloquentPaymentLedger implements PaymentLedger
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly DrawerCash $drawer,
    ) {}

    public function requireSession(TenantUser $actor, string $branchId): array
    {
        $session = $this->sessionOf($actor, $branchId, required: true);

        return ['id' => $session->id, 'number' => $session->number, 'cash_register_id' => $session->cash_register_id];
    }

    public function record(TenantUser $actor, string $branchId, array $entries, PaymentSource $source): void
    {
        if ($entries === []) {
            return;
        }

        $cashEffect = array_reduce($entries, fn (string $sum, LedgerEntry $e) => Decimal::add($sum, $e->cashEffect(), 2), '0.00');
        $touchesCash = array_filter($entries, fn (LedgerEntry $e) => $e->method->isCash()) !== [];
        $session = $this->sessionOf($actor, $branchId, required: $touchesCash);

        if ($session !== null && Decimal::isNegative($cashEffect)) {
            $available = $this->drawer->expected($session);
            if (Decimal::isNegative(Decimal::add($available, $cashEffect, 2))) {
                throw new BusinessRuleViolation('INSUFFICIENT_CASH', "The drawer of {$session->number} holds {$available} in cash; it cannot pay out ".Decimal::negate($cashEffect, 2).'.', [
                    'available' => $available,
                    'required' => Decimal::negate($cashEffect, 2),
                ]);
            }
        }

        $organizationId = $this->tenant->requireOrganization();
        $currency = $this->organizations->summary($organizationId)['base_currency'] ?? config('pos.default_currency');
        $now = now();

        foreach ($entries as $entry) {
            Payment::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $branchId,
                'cash_register_session_id' => $session?->id,
                'direction' => $entry->direction,
                'method' => $entry->method,
                'currency' => $currency,
                'amount' => Decimal::round($entry->amount, 2),
                'source_type' => $source->type,
                'source_id' => $source->id,
                'source_number' => $source->number,
                'customer_id' => $entry->customerId,
                'reference' => $entry->reference,
                'description' => $entry->description,
                'created_by' => $actor->getAuthIdentifier(),
                'created_at' => $now,
            ]);
        }
    }

    /**
     * The actor's open session (locked) when it is in this branch.
     *
     * @throws BusinessRuleViolation CASH_SESSION_REQUIRED
     */
    private function sessionOf(TenantUser $actor, string $branchId, bool $required): ?RegisterSession
    {
        /** @var RegisterSession|null $session */
        $session = RegisterSession::query()
            ->where('opened_by', $actor->getAuthIdentifier())
            ->where('status', SessionStatus::Open)
            ->lockForUpdate()
            ->first();

        if ($session !== null && $session->branch_id === $branchId) {
            return $session;
        }
        if (! $required) {
            return null;
        }

        throw new BusinessRuleViolation('CASH_SESSION_REQUIRED', $session === null
            ? 'Open a register session (shift) in this branch before taking or paying out cash.'
            : "Your open session {$session->number} is in another branch; close it and open one in this branch.", [
                'branch_id' => $branchId,
                'open_session_id' => $session?->id,
            ]);
    }
}
