<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Sales\Application\Services\ReturnPlanner;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Critical workflow #10 (first half): a return against the original invoice. Written as a
 * pending request that reserves the quantities; someone with `returns.approve` completes it
 * (CompleteSaleReturn). An approver's own return is completed straight away.
 */
class RequestSaleReturn
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly BranchDirectory $branches,
        private readonly ReturnPlanner $planner,
        private readonly SequenceGenerator $sequences,
        private readonly CompleteSaleReturn $complete,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{sale_id: string, return_reason_id?: ?string, notes?: ?string, lines: list<array{sale_line_id: string, quantity: string, restock?: ?bool, serials?: ?list<string>}>, refunds?: ?list<array{method: string, amount: string, reference?: ?string}>}  $data
     */
    public function __invoke(TenantUser $actor, array $data): SaleReturn
    {
        $sale = Sale::query()->find($data['sale_id']);
        if ($sale === null || ! $actor->canAccessBranch($sale->branch_id)) {
            throw ValidationException::withMessages(['sale_id' => ['The selected invoice does not exist.']]);
        }
        $reason = null;
        if (filled($data['return_reason_id'] ?? null)) {
            $reason = ReturnReason::query()->whereKey($data['return_reason_id'])->where('is_active', true)->first()
                ?? throw ValidationException::withMessages(['return_reason_id' => ['The selected reason does not exist.']]);
        }
        $organizationId = $this->context->organizationId();

        return DB::transaction(function () use ($actor, $sale, $reason, $data, $organizationId) {
            /** @var Sale $locked */
            $locked = Sale::query()->whereKey($sale->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== SaleStatus::Completed) {
                throw new BusinessRuleViolation('SALE_CANCELLED', "{$locked->number} was cancelled; nothing can be returned.");
            }

            $plan = $this->planner->lines($locked, $data['lines'], $reason);
            $branchCode = $this->branches->profile($locked->branch_id, $organizationId)['code'] ?? 'RET';
            $now = now();

            $return = SaleReturn::query()->create([
                'id' => (string) Str::uuid7(),
                'organization_id' => $organizationId,
                'branch_id' => $locked->branch_id,
                'store_id' => $locked->store_id,
                'sale_id' => $locked->id,
                'customer_id' => $locked->customer_id,
                'number' => $this->sequences->next($organizationId, "sale_return:{$locked->branch_id}", "RET-{$branchCode}-"),
                'status' => ReturnStatus::Pending,
                'return_reason_id' => $reason?->id,
                'notes' => filled($data['notes'] ?? null) ? trim($data['notes']) : null,
                'currency' => $locked->currency,
                'subtotal' => $plan['subtotal'],
                'tax_total' => $plan['tax_total'],
                'total' => $plan['total'],
                'requested_by' => $actor->getAuthIdentifier(),
                'requested_at' => $now,
            ]);

            foreach ($plan['lines'] as $line) {
                SaleReturnLine::query()->create([
                    'organization_id' => $organizationId,
                    'sale_return_id' => $return->id,
                    'sale_line_id' => $line['sale_line']->id,
                    'variant_id' => $line['sale_line']->variant_id,
                    'quantity' => $line['quantity'],
                    'restock' => $line['restock'],
                    'net_amount' => $line['net_amount'],
                    'tax_amount' => $line['tax_amount'],
                    'line_total' => $line['line_total'],
                    'unit_cost' => $line['sale_line']->unit_cost,
                    'cost_total' => $line['cost_total'],
                    'serials' => $line['serials'],
                    'created_at' => $now,
                ]);
            }

            $this->audit->record('sale_return.requested', $return, new: [
                'number' => $return->number,
                'sale' => $locked->number,
                'total' => $return->total,
                'reason' => $reason?->name,
            ]);

            if (Gate::forUser($actor)->allows('returns.approve')) {
                return ($this->complete)($actor, $return, $data['refunds'] ?? []);
            }

            return $return;
        });
    }
}
