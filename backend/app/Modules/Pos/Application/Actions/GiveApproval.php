<?php

namespace App\Modules\Pos\Application\Actions;

use App\Modules\Authentication\Application\Contracts\TillPins;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Pos\Infrastructure\Models\PosApproval;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Validation\ValidationException;

/**
 * POS1a: a manager approves a price change or a discount (POS1c: a return — an exchange) at the
 * till by picking their name and typing their PIN on the cashier's screen. The approver needs
 * the action's permission and the
 * store's branch; the PIN is checked with the PIN lockout and never stored or audited.
 */
class GiveApproval
{
    public const MINUTES = 10;

    /** Permission an approver needs per action. */
    public const PERMISSIONS = [
        TillApprovals::PRICE_OVERRIDE => 'sales.price_override',
        TillApprovals::DISCOUNT => 'sales.discount',
        TillApprovals::RETURN => 'returns.approve',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly TillPins $pins,
        private readonly ProductDirectory $products,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * Who may approve the action at the store: everyone eligible with a PIN except the requester.
     *
     * @return list<array{id: string, name: string}>
     */
    public function approvers(TenantUser $requester, string $action, string $storeId): array
    {
        $store = $this->storeAccess->require($requester, $storeId);

        return $this->pins->candidates(
            $this->tenant->requireOrganization(),
            $store['branch_id'],
            self::PERMISSIONS[$action],
            (string) $requester->getAuthIdentifier(),
        );
    }

    /**
     * @param  array{action: string, approver_id: string, pin: string, store_id: string, details?: array<string, mixed>|null}  $data
     * @return array{id: string, action: string, approver: array{id: string, name: string}, expires_at: string}
     */
    public function __invoke(TenantUser $requester, array $data): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $store = $this->storeAccess->require($requester, $data['store_id']);
        $action = $data['action'];
        $details = $this->details($organizationId, $action, $data['details'] ?? []);
        $requesterId = (string) $requester->getAuthIdentifier();

        if ($data['approver_id'] === $requesterId
            || ! $this->pins->mayAct($organizationId, $data['approver_id'], $store['branch_id'], self::PERMISSIONS[$action])) {
            throw new BusinessRuleViolation('APPROVER_NOT_ALLOWED', 'This person cannot approve this here. Choose a manager of this branch.');
        }

        $approver = $this->pins->verify($organizationId, $data['approver_id'], $data['pin']);

        $approval = PosApproval::query()->create([
            'store_id' => $store['id'],
            'action' => $action,
            'approver_id' => $approver['id'],
            'requester_id' => $requesterId,
            'details' => $details,
            'expires_at' => now()->addMinutes(self::MINUTES),
            'created_at' => now(),
        ]);
        $this->audit->record('pos.approval_given', $approval, context: [
            'action' => $action,
            'approver_id' => $approver['id'],
            'requester_id' => $requesterId,
            'store_id' => $store['id'],
            'details' => $details,
        ]);

        return [
            'id' => $approval->id,
            'action' => $action,
            'approver' => $approver,
            'expires_at' => $approval->expires_at->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, mixed>  $details
     * @return array<string, mixed>
     */
    private function details(string $organizationId, string $action, array $details): array
    {
        if ($action === TillApprovals::DISCOUNT) {
            return isset($details['scope']) ? ['scope' => $details['scope']] : [];
        }

        if ($action === TillApprovals::RETURN) {
            // The invoice whose items come back (tenant-scoped: another organization's is unknown).
            $saleId = $details['sale_id'] ?? null;
            if (! is_string($saleId) || ! Sale::query()->whereKey($saleId)->exists()) {
                throw ValidationException::withMessages(['details.sale_id' => ['Choose the invoice of the exchange.']]);
            }

            return ['sale_id' => $saleId];
        }

        $variantId = $details['variant_id'] ?? null;
        if (! is_string($variantId) || $this->products->variants($organizationId, [$variantId]) === []) {
            throw ValidationException::withMessages(['details.variant_id' => ['Choose an item of the cart.']]);
        }

        return array_filter(
            ['variant_id' => $variantId, 'unit_price' => $details['unit_price'] ?? null],
            fn ($value) => $value !== null,
        );
    }
}
