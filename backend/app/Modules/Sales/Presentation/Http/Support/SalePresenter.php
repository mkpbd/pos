<?php

namespace App\Modules\Sales\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SaleLineStock;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Shapes sales for the API and decides which sales a user may see: everything in their
 * branches with `sales.view`, otherwise (POS-only users) just the sales they rang up.
 */
class SalePresenter
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly BranchDirectory $branches,
        private readonly CustomerDirectory $customers,
        private readonly UserDirectory $users,
        private readonly BatchDirectory $batches,
    ) {}

    /**
     * @param  Builder<Sale>  $query
     */
    public function scopeVisible(Builder $query, TenantUser $user): void
    {
        if (Gate::forUser($user)->allows('sales.view')) {
            $accessible = $user->accessibleBranchIds();
            if ($accessible !== null) {
                $query->whereIn('branch_id', $accessible);
            }

            return;
        }
        if (Gate::forUser($user)->allows('pos.sell')) {
            $query->where('created_by', $user->getAuthIdentifier());

            return;
        }

        throw new AccessDeniedHttpException;
    }

    public function assertVisible(TenantUser $user, Sale $sale): void
    {
        $visible = Gate::forUser($user)->allows('sales.view')
            ? $user->canAccessBranch($sale->branch_id)
            : Gate::forUser($user)->allows('pos.sell') && $sale->created_by === $user->getAuthIdentifier();

        if (! $visible) {
            throw new NotFoundHttpException;
        }
    }

    /**
     * @param  Collection<int, Sale>  $sales
     * @return callable(Sale): array<string, mixed>
     */
    public function headers(Collection $sales): callable
    {
        $org = $this->context->organizationId();
        $stores = $this->branches->storeSummaries($org, $sales->pluck('store_id')->unique()->values()->all());
        $customers = $this->customers->summaries($org, $sales->pluck('customer_id')->filter()->unique()->values()->all());
        $users = $this->users->names($org, $sales->flatMap(fn (Sale $s) => [$s->created_by, $s->cancelled_by])->filter()->unique()->values()->all());

        return fn (Sale $sale) => $this->header($sale, $stores, $customers, $users);
    }

    /**
     * The full invoice: lines with batches and serials, payments, and what a receipt prints.
     *
     * @return array<string, mixed>
     */
    public function document(Sale $sale, bool $withCost): array
    {
        $org = $this->context->organizationId();
        $lines = $sale->lines()->with(['stock', 'serials'])->get();
        $payments = $sale->payments()->get();
        $batches = $this->batches->summaries($org, $lines->flatMap(fn (SaleLine $l) => $l->stock->pluck('batch_id'))->filter()->values()->all());
        $users = $this->users->names($org, array_values(array_filter([$sale->created_by, $sale->cancelled_by, ...$payments->pluck('created_by')->all()])));
        $organization = $this->context->organization();
        $branch = $this->branches->profile($sale->branch_id, $org);

        return ($this->headers(collect([$sale])))($sale) + [
            'notes' => $sale->notes,
            'invoice_discount' => $sale->invoice_discount_type === null ? null : [
                'type' => $sale->invoice_discount_type,
                'value' => $sale->invoice_discount_value,
                'source' => $sale->invoice_discount_source,
            ],
            'cost_total' => $withCost ? $sale->cost_total : null,
            'lines' => $lines->map(fn (SaleLine $l) => [
                'id' => $l->id,
                'variant_id' => $l->variant_id,
                'product_name' => $l->product_name,
                'variant_name' => $l->variant_name,
                'sku' => $l->sku,
                'unit_code' => $l->unit_code,
                'quantity' => $l->quantity,
                'unit_price' => $l->unit_price,
                'discount' => $l->discount_type === null ? null : ['type' => $l->discount_type, 'value' => $l->discount_value],
                'line_subtotal' => $l->line_subtotal,
                'discount_amount' => $l->discount_amount,
                'invoice_discount_share' => $l->invoice_discount_share,
                'net_amount' => $l->net_amount,
                'tax_rate' => $l->tax_rate,
                'tax_amount' => $l->tax_amount,
                'line_total' => $l->line_total,
                'unit_cost' => $withCost ? $l->unit_cost : null,
                'batches' => $l->stock->filter(fn (SaleLineStock $s) => $s->batch_id !== null)->map(fn (SaleLineStock $s) => [
                    'batch_number' => $batches[$s->batch_id]['batch_number'] ?? null,
                    'expires_on' => $batches[$s->batch_id]['expires_on'] ?? null,
                    'quantity' => $s->quantity,
                ])->values()->all(),
                'serials' => $l->serials->map(fn (SaleLineSerial $s) => $s->serial)->all(),
            ])->all(),
            'payments' => $payments->map(fn (SalePayment $p) => [
                'id' => $p->id,
                'kind' => $p->kind,
                'method' => $p->method->value,
                'method_label' => $p->method->label(),
                'amount' => $p->amount,
                'tendered' => $p->tendered,
                'reference' => $p->reference,
                'created_at' => $p->created_at->toIso8601String(),
                'created_by' => $users[$p->created_by] ?? null,
            ])->all(),
            'receipt' => [
                'organization_name' => $organization['name'] ?? null,
                'header' => $organization['receipt_header'] ?? null,
                'footer' => $organization['receipt_footer'] ?? null,
                'branch' => $branch,
                'timezone' => $organization['timezone'] ?? null,
            ],
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $stores
     * @param  array<string, array<string, mixed>>  $customers
     * @param  array<string, string>  $users
     * @return array<string, mixed>
     */
    private function header(Sale $sale, array $stores, array $customers, array $users): array
    {
        $store = $stores[$sale->store_id] ?? null;

        return [
            'id' => $sale->id,
            'number' => $sale->number,
            'status' => $sale->status->value,
            'sold_at' => $sale->sold_at->toIso8601String(),
            'store' => $store === null ? null : ['id' => $store['id'], 'code' => $store['code'], 'name' => $store['name']],
            'branch' => $store === null ? null : ['id' => $store['branch_id'], 'name' => $store['branch_name']],
            'customer' => $sale->customer_id === null ? null : ($customers[$sale->customer_id] ?? null),
            'cashier' => $sale->created_by === null ? null : ['id' => $sale->created_by, 'name' => $users[$sale->created_by] ?? null],
            'tax_mode' => $sale->tax_mode->value,
            'currency' => $sale->currency,
            'subtotal' => $sale->subtotal,
            'item_discount_total' => $sale->item_discount_total,
            'invoice_discount_total' => $sale->invoice_discount_total,
            'tax_total' => $sale->tax_total,
            'total' => $sale->total,
            'paid_total' => $sale->paid_total,
            'change_total' => $sale->change_total,
            'due_total' => $sale->due_total,
            'cancelled_at' => $sale->cancelled_at?->toIso8601String(),
            'cancelled_by' => $sale->cancelled_by === null ? null : ($users[$sale->cancelled_by] ?? null),
            'cancellation_reason' => $sale->cancellation_reason,
        ];
    }
}
