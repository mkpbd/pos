<?php

namespace App\Modules\Sales\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Inventory\Application\Contracts\BatchDirectory;
use App\Modules\Sales\Application\Contracts\StoreCredit;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Application\Services\StoredValueTenders;
use App\Modules\Sales\Domain\MushakInvoice;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SaleLineStock;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLine;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
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
        private readonly StoreCredit $storeCredit,
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
        // POS1c: sales made by an exchange at the till (their return points at them).
        $exchanges = array_flip(SaleReturn::query()->whereIn('exchange_sale_id', $sales->pluck('id')->all())->pluck('exchange_sale_id')->all());

        return fn (Sale $sale) => $this->header($sale, $stores, $customers, $users) + [
            'is_exchange' => isset($exchanges[$sale->id]),
        ];
    }

    /**
     * The full invoice: lines with batches, serials and returned quantities, payments, returns,
     * and what a receipt prints.
     *
     * @return array<string, mixed>
     */
    public function document(Sale $sale, bool $withCost): array
    {
        $org = $this->context->organizationId();
        $lines = $sale->lines()->with(['stock', 'serials'])->get();
        $payments = $sale->payments()->get();
        $batches = $this->batches->summaries($org, $lines->flatMap(fn (SaleLine $l) => $l->stock->pluck('batch_id'))->filter()->values()->all());
        $users = $this->users->names($org, array_values(array_unique(array_filter([
            $sale->created_by, $sale->cancelled_by, ...$payments->pluck('created_by')->all(),
            // POS1a: the managers who approved changed prices and manual discounts.
            $sale->discount_approved_by, ...$lines->pluck('price_approved_by')->all(),
        ]))));
        $till = SaleTillDetails::of($sale, $lines, $users);
        $organization = $this->context->organization();
        $taxNumber = trim((string) ($organization['tax_number'] ?? ''));
        $taxNumber = $taxNumber === '' ? null : $taxNumber;
        $branch = $this->branches->profile($sale->branch_id, $org);
        $returns = SaleReturn::query()->where('sale_id', $sale->id)->orderBy('requested_at')->get();
        $returned = SaleReturnLine::query()
            ->whereIn('sale_return_id', $returns->whereIn('status', [ReturnStatus::Pending, ReturnStatus::Completed])->pluck('id'))
            ->get()
            ->groupBy('sale_line_id')
            ->map(fn ($rows) => [
                'returned' => $rows->filter(fn (SaleReturnLine $l) => $returns->firstWhere('id', $l->sale_return_id)?->status === ReturnStatus::Completed)
                    ->reduce(fn (string $sum, SaleReturnLine $l) => Decimal::add($sum, $l->quantity, 3), '0.000'),
                'pending' => $rows->filter(fn (SaleReturnLine $l) => $returns->firstWhere('id', $l->sale_return_id)?->status === ReturnStatus::Pending)
                    ->reduce(fn (string $sum, SaleReturnLine $l) => Decimal::add($sum, $l->quantity, 3), '0.000'),
            ]);

        return ($this->headers(collect([$sale])))($sale) + [
            'notes' => $sale->notes,
            'invoice_discount' => $sale->invoice_discount_type === null ? null : [
                'type' => $sale->invoice_discount_type,
                'value' => $sale->invoice_discount_value,
                'source' => $sale->invoice_discount_source,
            ],
            'cost_total' => $withCost ? $sale->cost_total : null,
            // POS1a: promotions, coupon, savings and the discount approver.
            ...$till['sale'],
            'lines' => $lines->map(fn (SaleLine $l) => $till['lines'][$l->id] + [
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
                'returned_serials' => $l->serials->filter(fn (SaleLineSerial $s) => $s->released_at !== null && $sale->cancelled_at === null)->map(fn (SaleLineSerial $s) => $s->serial)->values()->all(),
                'returned_quantity' => $returned[$l->id]['returned'] ?? '0.000',
                'pending_return_quantity' => $returned[$l->id]['pending'] ?? '0.000',
            ])->all(),
            'returns' => $returns->map(fn (SaleReturn $r) => [
                'id' => $r->id,
                'number' => $r->number,
                'status' => $r->status->value,
                'total' => $r->total,
                'credited_total' => $r->credited_total,
                'refunded_total' => $r->refunded_total,
                'requested_at' => $r->requested_at->toIso8601String(),
            ])->all(),
            'payments' => $payments->map(fn (SalePayment $p) => [
                'id' => $p->id,
                'kind' => $p->kind,
                'method' => $p->method->value,
                'method_label' => $p->method->label(),
                'amount' => $p->amount,
                'tendered' => $p->tendered,
                'reference' => $p->reference,
                // POS1b: the gift card a payment was made with (never the full code).
                'gift_card_last4' => StoredValueTenders::giftCardLast4($p->method, $p->reference),
                'created_at' => $p->created_at->toIso8601String(),
                'created_by' => $users[$p->created_by] ?? null,
            ])->all(),
            // POS1c: the items this sale was exchanged for (null unless made by an exchange).
            'exchange' => $this->exchange($sale, $payments),
            // POS1d: digital receipts sent by SMS / e-mail, newest first (recipients masked).
            'receipt_deliveries' => SaleReceiptHistory::of($sale, $this->users, $org),
            'receipt' => [
                'organization_name' => $organization['name'] ?? null,
                // Q1: the seller's BIN; the receipt is a tax invoice only when one is set.
                'tax_number' => $taxNumber,
                'is_tax_invoice' => $taxNumber !== null,
                'header' => $organization['receipt_header'] ?? null,
                'footer' => $organization['receipt_footer'] ?? null,
                'branch' => $branch,
                'timezone' => $organization['timezone'] ?? null,
                // POS1b: what the customer has left in store credit (now).
                'customer_store_credit_balance' => $sale->customer_id === null ? null : $this->storeCredit->balance($sale->customer_id),
            ],
            // VAT1: the Mushak-6.3 tax invoice (null without the seller's BIN).
            'mushak' => $taxNumber === null ? null : $this->mushak($sale, $lines, $organization, $taxNumber, $branch['address'] ?? null),
        ];
    }

    /**
     * VAT1: the Mushak-6.3 block — the buyer is the sale's customer (name, BIN, address) or a
     * walk-in customer; issued when sold, in the organization's timezone.
     *
     * @param  Collection<int, SaleLine>  $lines
     * @param  array<string, mixed>  $organization
     * @return array<string, mixed>
     */
    private function mushak(Sale $sale, Collection $lines, array $organization, string $taxNumber, ?string $branchAddress): array
    {
        $customer = $sale->customer_id === null ? null : $this->customers->invoiceDetails($this->context->organizationId(), $sale->customer_id);

        return MushakInvoice::of(
            ['name' => filled($organization['legal_name'] ?? null) ? $organization['legal_name'] : (string) ($organization['name'] ?? ''), 'bin' => $taxNumber,
                'address' => filled($organization['address'] ?? null) ? $organization['address'] : $branchAddress],
            $customer === null
                ? ['name' => 'Walk-in customer', 'bin' => null, 'address' => null]
                : ['name' => $customer['name'], 'bin' => $customer['tax_number'], 'address' => $customer['address']],
            $sale->number,
            $sale->sold_at->copy()->setTimezone($organization['timezone'] ?? config('app.timezone'))->toIso8601String(),
            $lines->map(fn (SaleLine $l) => [
                'description' => MushakInvoice::description($l->product_name, $l->variant_name),
                'unit' => $l->unit_code,
                'quantity' => $l->quantity,
                'unit_price' => $l->unit_price,
                'net_amount' => $l->net_amount,
                'tax_rate' => $l->tax_rate,
                'tax_amount' => $l->tax_amount,
                'line_total' => $l->line_total,
            ])->values()->all(),
            $sale->tax_mode === TaxMode::Inclusive,
            $sale->cancelled_at !== null,
        );
    }

    /**
     * POS1c: the return whose value paid (part of) this sale — `value` is what the returned items
     * were worth after any credit against the invoice's due (V), `applied` what paid this sale (A).
     *
     * @param  Collection<int, SalePayment>  $payments
     * @return array<string, mixed>|null
     */
    private function exchange(Sale $sale, Collection $payments): ?array
    {
        $return = SaleReturn::query()->where('exchange_sale_id', $sale->id)->first();
        if ($return === null) {
            return null;
        }

        $lines = $return->lines()->get();
        $saleLines = SaleLine::query()->whereKey($lines->pluck('sale_line_id'))->get()->keyBy('id');

        return [
            'return_id' => $return->id,
            'return_number' => $return->number,
            'original_sale_id' => $return->sale_id,
            'original_sale_number' => Sale::query()->whereKey($return->sale_id)->value('number'),
            'value' => $return->refunded_total,
            'applied' => $payments->filter(fn (SalePayment $p) => $p->method === PaymentMethod::Exchange)
                ->reduce(fn (string $sum, SalePayment $p) => Decimal::add($sum, $p->amount, 2), '0.00'),
            'lines' => $lines->sortBy(fn (SaleReturnLine $l) => $saleLines[$l->sale_line_id]->position ?? 0)->values()
                ->map(fn (SaleReturnLine $l) => [
                    'product_name' => $saleLines[$l->sale_line_id]->product_name ?? null,
                    'variant_name' => $saleLines[$l->sale_line_id]->variant_name ?? null,
                    'quantity' => $l->quantity,
                    'line_total' => $l->line_total,
                ])->all(),
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
