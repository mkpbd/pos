<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Application\Queries\CostEstimates;
use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Domain\PurchaseTotals;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Creates or replaces a draft purchase requisition (SC2). Estimated unit costs left empty are
 * prefilled (suggested supplier's catalog → preferred catalog → last cost → variant cost);
 * the estimate incl. tax (variant tax rates) is computed here, never taken from the client.
 * Only drafts can be edited, by the requester or a holder of `purchases.manage`.
 */
class SaveRequisition
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
        private readonly CostEstimates $estimates,
        private readonly SupplierDirectory $suppliers,
        private readonly ProcurementHistory $history,
        private readonly ApprovalRules $rules,
        private readonly OrganizationDate $dates,
    ) {}

    /**
     * @param  array{store_id: string, needed_by?: ?string, notes?: ?string, lines: list<array{variant_id: string, quantity: string, estimated_unit_cost?: ?string, suggested_supplier_id?: ?string, notes?: ?string}>}  $data
     */
    public function __invoke(TenantUser $actor, ?PurchaseRequisition $requisition, array $data, ?string $historyNote = null): PurchaseRequisition
    {
        if ($requisition !== null) {
            if ($requisition->requested_by !== (string) $actor->getAuthIdentifier() && ! $this->rules->has($actor, 'purchases.manage')) {
                throw new AuthorizationException('Only the requester or a purchasing manager can edit this requisition.');
            }
            if ($requisition->status !== RequisitionStatus::Draft) {
                throw new BusinessRuleViolation('REQUISITION_LOCKED', "Requisition {$requisition->number} is {$requisition->status->value} and can no longer be edited.");
            }
        }

        $organizationId = $this->context->organizationId();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $lines = array_values($data['lines']);
        $this->lineRules->validate($organizationId, $lines, 'in', requireTracked: false, checkBatches: false, requireSellable: true);

        $errors = [];
        if (($data['needed_by'] ?? null) !== null && $data['needed_by'] < $this->dates->today()) {
            $errors['needed_by'] = ['The needed-by date cannot be in the past.'];
        }
        $supplierIds = array_values(array_unique(array_filter(array_column($lines, 'suggested_supplier_id'))));
        $suppliers = $this->suppliers->contacts($organizationId, $supplierIds);
        foreach ($lines as $i => $line) {
            $supplierId = $line['suggested_supplier_id'] ?? null;
            if ($supplierId === null) {
                continue;
            }
            $supplier = $suppliers[$supplierId] ?? null;
            if ($supplier === null || $supplier['archived']) {
                $errors["lines.{$i}.suggested_supplier_id"] = ['The selected supplier does not exist.'];
            } elseif (! $supplier['is_active']) {
                $errors["lines.{$i}.suggested_supplier_id"] = ["{$supplier['name']} is inactive."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        $estimates = $this->estimates->forVariants(
            $organizationId,
            array_column($lines, 'variant_id'),
            array_combine(array_column($lines, 'variant_id'), array_map(fn (array $l) => $l['suggested_supplier_id'] ?? null, $lines)),
        );
        foreach ($lines as $i => $line) {
            $estimate = $estimates[$line['variant_id']];
            $cost = $line['estimated_unit_cost'] ?? null;
            $lines[$i]['unit_cost'] = Decimal::round($cost === null || $cost === '' ? $estimate['estimated_unit_cost'] : (string) $cost, 4);
            $lines[$i]['tax_rate'] = $estimate['tax_rate'];
            $lines[$i]['quantity'] = Decimal::round((string) $line['quantity'], 3);
        }
        $currency = $this->context->currency();
        $totals = PurchaseTotals::calculate($lines, $currency);

        return DB::transaction(function () use ($actor, $requisition, $organizationId, $store, $data, $lines, $totals, $currency, $historyNote) {
            $creating = $requisition === null;
            $requisition ??= new PurchaseRequisition([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'purchase_requisition', 'PR-'),
                'status' => RequisitionStatus::Draft,
                'requested_by' => (string) $actor->getAuthIdentifier(),
            ]);

            $requisition->fill([
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'needed_by' => $data['needed_by'] ?? null,
                'notes' => filled($data['notes'] ?? null) ? trim((string) $data['notes']) : null,
                'currency' => $currency,
                'estimated_subtotal' => $totals['subtotal'],
                'estimated_tax' => $totals['tax_total'],
                'estimated_total' => $totals['total'],
            ])->save();

            $requisition->lines()->delete();
            foreach ($lines as $i => $line) {
                $requisition->lines()->create([
                    'organization_id' => $organizationId,
                    'variant_id' => $line['variant_id'],
                    'quantity' => $line['quantity'],
                    'estimated_unit_cost' => $line['unit_cost'],
                    'tax_rate' => $line['tax_rate'],
                    'line_total' => $totals['lines'][$i]['line_total'],
                    'suggested_supplier_id' => $line['suggested_supplier_id'] ?? null,
                    'notes' => filled($line['notes'] ?? null) ? trim((string) $line['notes']) : null,
                    'sort_order' => $i,
                ]);
            }

            if ($creating) {
                $this->history->requisition($requisition, null, RequisitionStatus::Draft->value, $historyNote);
            }
            $this->audit->record($creating ? 'purchase_requisition.created' : 'purchase_requisition.updated', $requisition, new: [
                'number' => $requisition->number,
                'store_id' => $requisition->store_id,
                'estimated_total' => $requisition->estimated_total,
                'lines' => count($lines),
            ]);

            return $requisition;
        });
    }
}
