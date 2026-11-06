<?php

namespace App\Modules\Reports\Tests\Concerns;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Crafted report data: POS documents go through the real API (InteractsWithSales); web
 * orders, web refunds, expenses and ledger rows are inserted as the posted documents would
 * look, so each report's arithmetic can be checked against hand-computed figures.
 */
trait BuildsReportData
{
    use InteractsWithSales;

    private int $webOrders = 0;

    /**
     * An instant from an organization-local (Asia/Dhaka) date-time.
     */
    protected function dhaka(string $localDateTime): CarbonImmutable
    {
        return CarbonImmutable::parse($localDateTime, 'Asia/Dhaka')->setTimezone('UTC');
    }

    /**
     * @param  list<array{variant: ProductVariant, quantity: string, unit_price: string, discount?: string, tax_rate?: string, unit_cost: string}>  $lines
     * @param  array<string, mixed>  $order  status, delivered_at, shipping_total, cod_fee, tax_mode, branch_id, store_id
     * @return array{id: string, lines: list<string>}
     */
    protected function webOrder(Organization $org, string $storeId, array $lines, array $order = []): array
    {
        $id = (string) Str::uuid();
        $store = DB::table('stores')->where('id', $storeId)->first();
        $inclusive = ($order['tax_mode'] ?? 'exclusive') === 'inclusive';
        $placed = $order['placed_at'] ?? ($order['delivered_at'] ?? now())->copy()->subDay();
        $rows = [];
        $sums = ['subtotal' => '0', 'discount' => '0', 'tax' => '0', 'goods' => '0', 'cost' => '0'];
        foreach ($lines as $i => $l) {
            $subtotal = bcmul($l['quantity'], $l['unit_price'], 2);
            $amount = bcsub($subtotal, $l['discount'] ?? '0', 2);
            $rate = $l['tax_rate'] ?? '0';
            $tax = $inclusive ? bcdiv(bcmul($amount, $rate, 6), bcadd('100', $rate, 4), 2) : bcdiv(bcmul($amount, $rate, 6), '100', 2);
            $net = $inclusive ? bcsub($amount, $tax, 2) : $amount;
            $lineTotal = $inclusive ? $amount : bcadd($amount, $tax, 2);
            $cost = bcmul($l['quantity'], $l['unit_cost'], 2);
            $rows[] = [
                'id' => $lineId = (string) Str::uuid(),
                'organization_id' => $org->id,
                'order_id' => $id,
                'position' => $i,
                'product_id' => $l['variant']->product_id,
                'variant_id' => $l['variant']->id,
                'product_name' => 'Line '.$i,
                'sku' => $l['variant']->sku,
                'quantity' => $l['quantity'],
                'unit_price' => $l['unit_price'],
                'line_subtotal' => $subtotal,
                'discount_amount' => $l['discount'] ?? '0',
                'net_amount' => $net,
                'tax_rate' => $rate,
                'tax_amount' => $tax,
                'line_total' => $lineTotal,
                'unit_cost' => $l['unit_cost'],
                'cost_total' => $cost,
                'created_at' => $placed,
            ];
            $sums['subtotal'] = bcadd($sums['subtotal'], $subtotal, 2);
            $sums['discount'] = bcadd($sums['discount'], $l['discount'] ?? '0', 2);
            $sums['tax'] = bcadd($sums['tax'], $tax, 2);
            $sums['goods'] = bcadd($sums['goods'], $lineTotal, 2);
            $sums['cost'] = bcadd($sums['cost'], $cost, 2);
        }
        $shipping = $order['shipping_total'] ?? '0';
        $cod = $order['cod_fee'] ?? '0';
        DB::table('orders')->insert([
            'id' => $id,
            'organization_id' => $org->id,
            'number' => sprintf('WEB-%06d', ++$this->webOrders),
            'branch_id' => $order['branch_id'] ?? $store->branch_id,
            'store_id' => $storeId,
            'status' => $order['status'] ?? 'delivered',
            'payment_status' => $order['payment_status'] ?? 'paid',
            'payment_method' => 'cod',
            'shipping_method_name' => 'Home delivery',
            'currency' => 'BDT',
            'tax_mode' => $inclusive ? 'inclusive' : 'exclusive',
            'subtotal' => $sums['subtotal'],
            'discount_total' => $sums['discount'],
            'tax_total' => $sums['tax'],
            'shipping_total' => $shipping,
            'cod_fee' => $cod,
            'total' => bcadd(bcadd($sums['goods'], $shipping, 2), $cod, 2),
            'paid_total' => '0',
            'cost_total' => $sums['cost'],
            'contact_name' => $order['contact_name'] ?? 'Rina Akter',
            'contact_email' => 'rina@example.test',
            'contact_phone' => '01712345678',
            'placed_at' => $placed,
            'delivered_at' => ($order['status'] ?? 'delivered') === 'delivered' ? ($order['delivered_at'] ?? now()) : null,
            'created_at' => $placed,
            'updated_at' => $placed,
        ]);
        DB::table('order_lines')->insert($rows);

        return ['id' => $id, 'lines' => array_column($rows, 'id')];
    }

    /**
     * A refunded web return.
     *
     * @param  list<array{line: string, quantity: string, amount: string, tax?: string, cost: string, restock: bool}>  $lines
     */
    protected function webRefund(Organization $org, string $orderId, array $lines, CarbonImmutable $refundedAt, string $shippingRefund = '0', string $status = 'refunded'): string
    {
        $id = (string) Str::uuid();
        $items = array_reduce($lines, fn (string $s, array $l) => bcadd($s, $l['amount'], 2), '0');
        DB::table('order_returns')->insert([
            'id' => $id,
            'organization_id' => $org->id,
            'order_id' => $orderId,
            'number' => 'RTN-WEB-'.Str::random(6),
            'status' => $status,
            'reason_code' => 'damaged',
            'requested_by' => 'customer',
            'currency' => 'BDT',
            'items_amount' => $items,
            'shipping_refund' => $shippingRefund,
            'refund_amount' => bcadd($items, $shippingRefund, 2),
            'refund_method' => $status === 'refunded' ? 'cash' : null,
            'approved_at' => $refundedAt,
            'received_at' => $refundedAt,
            'refunded_at' => $status === 'refunded' ? $refundedAt : null,
            'created_at' => $refundedAt,
            'updated_at' => $refundedAt,
        ]);
        DB::table('order_return_lines')->insert(array_map(fn (array $l) => [
            'id' => (string) Str::uuid(),
            'organization_id' => $org->id,
            'return_id' => $id,
            'order_line_id' => $l['line'],
            'requested_quantity' => $l['quantity'],
            'quantity' => $l['quantity'],
            'amount' => $l['amount'],
            'tax_amount' => $l['tax'] ?? '0',
            'cost_total' => $l['cost'],
            'restock' => $l['restock'],
            'restocked_quantity' => $l['restock'] ? $l['quantity'] : '0',
            'created_at' => $refundedAt,
        ], $lines));

        return $id;
    }

    protected function expense(Organization $org, string $branchId, string $category, string $amount, string $on, string $type = 'expense', bool $voided = false, bool $onAccount = false): void
    {
        $categoryId = DB::table('expense_categories')->where('organization_id', $org->id)->where('type', $type)->where('name', $category)->value('id');
        if ($categoryId === null) {
            DB::table('expense_categories')->insert(['id' => $categoryId = (string) Str::uuid(), 'organization_id' => $org->id, 'type' => $type,
                'name' => $category, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('expenses')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $org->id,
            'branch_id' => $branchId,
            'type' => $type,
            'number' => ($type === 'expense' ? 'EXP-' : 'INC-').Str::random(6),
            'expense_category_id' => $categoryId,
            'currency' => 'BDT',
            'amount' => $amount,
            'method' => $onAccount ? 'other' : 'bank_transfer',
            'on_account' => $onAccount,
            'occurred_on' => $on,
            'voided_at' => $voided ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    protected function ledger(Organization $org, string $branchId, string $direction, string $method, string $amount, string $source, CarbonImmutable $at, ?string $userId = null): void
    {
        DB::table('payments')->insert([
            'id' => (string) Str::uuid(),
            'organization_id' => $org->id,
            'branch_id' => $branchId,
            'direction' => $direction,
            'method' => $method,
            'currency' => 'BDT',
            'amount' => $amount,
            'source_type' => $source,
            'created_by' => $userId,
            'created_at' => $at,
        ]);
    }

    /**
     * A POS return through the API (approved at once by an approver with an open session).
     *
     * @param  list<array{0: string, 1: string, 2?: bool}>  $lines  [sale line id, quantity, restock]
     * @param  list<array{0: string, 1: string}>  $refunds
     */
    protected function posReturn(string $saleId, array $lines, array $refunds): TestResponse
    {
        return $this->postJson('/api/v1/returns', [
            'sale_id' => $saleId,
            'lines' => array_map(fn (array $l) => ['sale_line_id' => $l[0], 'quantity' => $l[1], 'restock' => $l[2] ?? true], $lines),
            'refunds' => array_map(fn (array $r) => ['method' => $r[0], 'amount' => $r[1]], $refunds),
        ], ['Idempotency-Key' => (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $params
     */
    protected function report(string $key, array $params = []): TestResponse
    {
        return $this->getJson('/api/v1/reports/'.$key.($params === [] ? '' : '?'.http_build_query($params)));
    }

    /**
     * Report rows keyed by one column.
     *
     * @param  array<string, mixed>  $params
     * @return array<string, array<string, mixed>>
     */
    protected function rowsBy(string $key, array $params, string $column): array
    {
        return collect($this->report($key, $params + ['per_page' => 500])->assertOk()->json('data'))->keyBy($column)->all();
    }
}
