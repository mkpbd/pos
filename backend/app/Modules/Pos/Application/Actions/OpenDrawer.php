<?php

namespace App\Modules\Pos\Application\Actions;

use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Pos\Infrastructure\Models\DrawerOpening;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * POS1d: the cashier opens the cash drawer without a sale ("no sale") — with `pos.no_sale`, or
 * with a manager's `no_sale` approval by PIN (used once). The opening is recorded on the
 * cashier's open register session in the store's branch; no money moves.
 */
class OpenDrawer
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly PaymentLedger $ledger,
        private readonly TillApprovals $approvals,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{store_id: string, reason: string, approval_id?: ?string}  $data
     * @param  array{id: string, organization_id: string, branch_id: string}|null  $terminal  the till of this device (its cookie)
     * @return array{id: string, opened_at: string, approved_by: array{id: string, name: string}|null}
     *
     * @throws BusinessRuleViolation APPROVAL_REQUIRED, APPROVAL_INVALID, CASH_SESSION_REQUIRED
     */
    public function __invoke(TenantUser $actor, array $data, ?array $terminal = null): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $actorId = (string) $actor->getAuthIdentifier();
        $approval = $this->approval($actor, $store['id'], $data['approval_id'] ?? null);

        return DB::transaction(function () use ($actor, $actorId, $organizationId, $store, $approval, $data, $terminal) {
            $session = $this->ledger->requireSession($actor, $store['branch_id']);
            $sameTill = $terminal !== null && $terminal['organization_id'] === $organizationId && $terminal['branch_id'] === $store['branch_id'];

            $opening = DrawerOpening::query()->create([
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'register_session_id' => $session['id'],
                'register_session_number' => $session['number'],
                'terminal_id' => $sameTill ? $terminal['id'] : null,
                'user_id' => $actorId,
                'approved_by' => $approval['approver_id'] ?? null,
                'approval_id' => $approval['id'] ?? null,
                'reason' => $data['reason'],
                'opened_at' => now(),
            ]);
            if ($approval !== null) {
                $this->approvals->consume($approval['id'], $opening->id);
            }

            $this->audit->record('pos.drawer_opened', $opening, new: [
                'reason' => $opening->reason,
                'register_session' => $session['number'],
                'approved_by' => $approval === null ? null : ['id' => $approval['approver_id'], 'name' => $approval['approver_name']],
            ], context: [
                'store_id' => $store['id'],
                'terminal_id' => $opening->terminal_id,
                'approval_id' => $opening->approval_id,
            ]);

            return [
                'id' => $opening->id,
                'opened_at' => $opening->opened_at->toIso8601String(),
                'approved_by' => $approval === null ? null : ['id' => $approval['approver_id'], 'name' => $approval['approver_name']],
            ];
        });
    }

    /**
     * The manager approval to use, or null when the actor may open the drawer themselves.
     *
     * @return array{id: string, approver_id: string, approver_name: string}|null
     */
    private function approval(TenantUser $actor, string $storeId, ?string $approvalId): ?array
    {
        if (Gate::forUser($actor)->allows('pos.no_sale')) {
            return null;
        }
        if (blank($approvalId)) {
            throw new BusinessRuleViolation('APPROVAL_REQUIRED', 'A manager must approve opening the drawer without a sale.', [
                'action' => TillApprovals::NO_SALE,
            ]);
        }

        return $this->approvals->check($approvalId, (string) $actor->getAuthIdentifier(), TillApprovals::NO_SALE, ['store_id' => $storeId]);
    }
}
