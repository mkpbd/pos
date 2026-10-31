<?php

namespace App\Modules\Sales\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Sales\Application\Services\ReturnPlanner;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLine;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLineStock;
use App\Modules\Sales\Infrastructure\Models\SaleReturnRefund;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;

/**
 * Shapes sales returns for the API: list headers and the full document (lines, batches
 * restocked, refunds, and for pending returns how they would be settled now).
 */
class ReturnPresenter
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly BranchDirectory $branches,
        private readonly CustomerDirectory $customers,
        private readonly UserDirectory $users,
        private readonly BatchDirectory $batches,
        private readonly ReturnPlanner $planner,
    ) {}

    /**
     * @param  Collection<int, SaleReturn>  $returns
     * @return callable(SaleReturn): array<string, mixed>
     */
    public function headers(Collection $returns): callable
    {
        $org = $this->context->organizationId();
        $sales = Sale::query()->whereKey($returns->pluck('sale_id')->unique())->pluck('number', 'id');
        $stores = $this->branches->storeSummaries($org, $returns->pluck('store_id')->unique()->values()->all());
        $customers = $this->customers->summaries($org, $returns->pluck('customer_id')->filter()->unique()->values()->all());
        $reasons = ReturnReason::query()->whereKey($returns->pluck('return_reason_id')->filter()->unique())->pluck('name', 'id');
        $users = $this->users->names($org, $returns->flatMap(fn (SaleReturn $r) => [$r->requested_by, $r->decided_by])->filter()->unique()->values()->all());

        return fn (SaleReturn $r) => [
            'id' => $r->id,
            'number' => $r->number,
            'status' => $r->status->value,
            'sale' => ['id' => $r->sale_id, 'number' => $sales[$r->sale_id] ?? null],
            'branch' => ($s = $stores[$r->store_id] ?? null) === null ? null : ['id' => $s['branch_id'], 'name' => $s['branch_name']],
            'store' => $s === null ? null : ['id' => $s['id'], 'code' => $s['code'], 'name' => $s['name']],
            'customer' => $r->customer_id === null ? null : ($customers[$r->customer_id] ?? null),
            'reason' => $r->return_reason_id === null ? null : ['id' => $r->return_reason_id, 'name' => $reasons[$r->return_reason_id] ?? null],
            'notes' => $r->notes,
            'currency' => $r->currency,
            'subtotal' => $r->subtotal,
            'tax_total' => $r->tax_total,
            'total' => $r->total,
            'credited_total' => $r->credited_total,
            'refunded_total' => $r->refunded_total,
            'requested_by' => $r->requested_by === null ? null : ['id' => $r->requested_by, 'name' => $users[$r->requested_by] ?? null],
            'requested_at' => $r->requested_at->toIso8601String(),
            'decided_by' => $r->decided_by === null ? null : ['id' => $r->decided_by, 'name' => $users[$r->decided_by] ?? null],
            'decided_at' => $r->decided_at?->toIso8601String(),
            'rejection_reason' => $r->rejection_reason,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function document(SaleReturn $return): array
    {
        $org = $this->context->organizationId();
        $lines = $return->lines()->with('stock')->get();
        $saleLines = SaleLine::query()->whereKey($lines->pluck('sale_line_id'))->get()->keyBy('id');
        $batches = $this->batches->summaries($org, $lines->flatMap(fn (SaleReturnLine $l) => $l->stock->pluck('batch_id'))->filter()->unique()->values()->all());
        $refunds = $return->refunds()->get();
        $users = $this->users->names($org, $refunds->pluck('created_by')->filter()->unique()->values()->all());

        return ($this->headers(collect([$return])))($return) + [
            'lines' => $lines->sortBy(fn (SaleReturnLine $l) => $saleLines[$l->sale_line_id]->position ?? 0)->values()->map(fn (SaleReturnLine $l) => [
                'id' => $l->id,
                'sale_line_id' => $l->sale_line_id,
                'variant_id' => $l->variant_id,
                'product_name' => $saleLines[$l->sale_line_id]->product_name ?? null,
                'variant_name' => $saleLines[$l->sale_line_id]->variant_name ?? null,
                'sku' => $saleLines[$l->sale_line_id]->sku ?? null,
                'unit_code' => $saleLines[$l->sale_line_id]->unit_code ?? null,
                'quantity' => $l->quantity,
                'restock' => $l->restock,
                'net_amount' => $l->net_amount,
                'tax_amount' => $l->tax_amount,
                'line_total' => $l->line_total,
                'serials' => $l->serials ?? [],
                'batches' => $l->stock->filter(fn (SaleReturnLineStock $s) => $s->batch_id !== null)->map(fn (SaleReturnLineStock $s) => [
                    'batch_number' => $batches[$s->batch_id]['batch_number'] ?? null,
                    'quantity' => $s->quantity,
                ])->values()->all(),
            ])->all(),
            'refunds' => $refunds->map(fn (SaleReturnRefund $r) => [
                'method' => $r->method->value,
                'method_label' => $r->method->label(),
                'amount' => $r->amount,
                'reference' => $r->reference,
                'created_by' => $r->created_by === null ? null : ($users[$r->created_by] ?? null),
                'created_at' => $r->created_at->toIso8601String(),
            ])->all(),
            'settlement' => $return->status === ReturnStatus::Pending
                ? $this->planner->settlement(Sale::query()->findOrFail($return->sale_id), $return->total)
                : null,
        ];
    }
}
