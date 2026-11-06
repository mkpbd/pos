<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Purchases per supplier or product: goods receipts (the supplier invoices) by invoice date.
 *   goods        = Σ line subtotal (excluding tax)
 *   tax          = Σ line tax
 *   landed_cost  = Σ charges allocated to the lines on the receipt (SC3) + Σ landed cost
 *                  voucher allocations to those lines (posted later, any date)
 *   landed_total = goods + landed_cost (what the goods cost in stock)
 *   returns      = Σ purchase return lines (excluding tax) returned in the period
 *   net_purchases = goods − returns
 * Money columns reveal purchase costs and are cost-sensitive.
 */
class PurchasesReport implements Report
{
    private const GROUPS = ['supplier' => 'Supplier', 'product' => 'Product'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'purchases',
            title: 'Purchases',
            description: 'Goods received per supplier or product with tax, landed costs and purchase returns.',
            group: ReportGroup::Purchasing,
            permission: 'reports.view',
            params: [
                ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::supplier(),
                ReportParam::product(), ReportParam::groupBy(self::GROUPS, 'supplier'),
            ],
            columns: [
                ReportColumn::text('group', 'Group'),
                ReportColumn::number('receipts', 'Receipts'),
                ReportColumn::quantity('quantity', 'Quantity received'),
                ReportColumn::money('goods', 'Goods', costSensitive: true),
                ReportColumn::money('tax', 'Tax', costSensitive: true),
                ReportColumn::money('landed_cost', 'Landed cost', costSensitive: true),
                ReportColumn::money('landed_total', 'Landed total', costSensitive: true),
                ReportColumn::quantity('returned_quantity', 'Quantity returned'),
                ReportColumn::money('returns', 'Returns', costSensitive: true),
                ReportColumn::money('net_purchases', 'Net purchases', costSensitive: true),
            ],
            defaultSort: '-goods',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $groupBy = (string) $context->param('group_by', 'supplier');
        $receiptKey = $groupBy === 'product' ? 'pv.product_id' : 'r.supplier_id';
        $returnKey = $groupBy === 'product' ? 'pv.product_id' : 'pr.supplier_id';

        $allocations = DB::table('landed_cost_allocations')->where('organization_id', $context->organizationId)
            ->groupBy('goods_receipt_line_id')->selectRaw('goods_receipt_line_id, SUM(amount) as amount');
        $received = fn (bool $grouped) => $this->receipts($context)
            ->leftJoinSub($allocations, 'a', 'a.goods_receipt_line_id', '=', 'l.id')
            ->when($grouped, fn (Builder $q) => $q->groupByRaw($receiptKey))
            ->selectRaw(($grouped ? $receiptKey.' as group_id, ' : '').'COUNT(DISTINCT r.id) as receipts, SUM(l.quantity) as quantity, SUM(l.line_subtotal) as goods, '
                .'SUM(l.line_tax) as tax, SUM(l.landed_cost + COALESCE(a.amount, 0)) as landed_cost');
        $returned = fn (bool $grouped) => $this->returns($context)
            ->when($grouped, fn (Builder $q) => $q->groupByRaw($returnKey))
            ->selectRaw(($grouped ? $returnKey.' as group_id, ' : '').'SUM(rl.quantity) as quantity, SUM(rl.line_subtotal) as amount');

        $groups = [];
        foreach ($received(true)->get() as $row) {
            $groups[$row->group_id] = ['receipts' => (int) $row->receipts, 'quantity' => $row->quantity, 'goods' => $row->goods, 'tax' => $row->tax, 'landed_cost' => $row->landed_cost];
        }
        foreach ($returned(true)->get() as $row) {
            $groups[$row->group_id] = ($groups[$row->group_id] ?? []) + ['returned_quantity' => $row->quantity, 'returns' => $row->amount];
        }
        $names = Names::of($groupBy, $context->organizationId, array_keys($groups));

        $rows = [];
        foreach ($groups as $id => $g) {
            $rows[] = ['group_id' => $id, 'group' => $names[$id] ?? 'Unknown'] + self::figures($g);
        }
        $total = (array) $received(false)->first();
        $totalReturns = (array) $returned(false)->first();

        return ReportResult::rows($rows, self::figures($total + ['returned_quantity' => $totalReturns['quantity'] ?? 0, 'returns' => $totalReturns['amount'] ?? 0]),
            ['group' => self::GROUPS[$groupBy] ?? 'Supplier']);
    }

    /**
     * @param  array<string, mixed>  $g
     * @return array<string, mixed>
     */
    private static function figures(array $g): array
    {
        $goods = Sql::money($g['goods'] ?? 0);
        $landed = Sql::money($g['landed_cost'] ?? 0);
        $returns = Sql::money($g['returns'] ?? 0);

        return [
            'receipts' => (int) ($g['receipts'] ?? 0),
            'quantity' => Sql::quantity($g['quantity'] ?? 0),
            'goods' => $goods,
            'tax' => Sql::money($g['tax'] ?? 0),
            'landed_cost' => $landed,
            'landed_total' => Decimal::add($goods, $landed, 2),
            'returned_quantity' => Sql::quantity($g['returned_quantity'] ?? 0),
            'returns' => $returns,
            'net_purchases' => Decimal::sub($goods, $returns, 2),
        ];
    }

    private function receipts(ReportContext $context): Builder
    {
        $query = DB::table('goods_receipt_lines as l')
            ->join('goods_receipts as r', 'r.id', '=', 'l.goods_receipt_id')
            ->join('product_variants as pv', 'pv.id', '=', 'l.variant_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.invoice_date', '>=', $context->from())
            ->where('r.invoice_date', '<', $context->toExclusive());
        $context->scopeBranches($query, 'r.branch_id');

        return $query->when($context->param('supplier_id'), fn (Builder $q, string $id) => $q->where('r.supplier_id', $id))
            ->when($context->param('product_id'), fn (Builder $q, string $id) => $q->where('pv.product_id', $id));
    }

    private function returns(ReportContext $context): Builder
    {
        $query = DB::table('purchase_return_lines as rl')
            ->join('purchase_returns as pr', 'pr.id', '=', 'rl.purchase_return_id')
            ->join('product_variants as pv', 'pv.id', '=', 'rl.variant_id')
            ->where('pr.organization_id', $context->organizationId)
            ->where('pr.created_at', '>=', $context->fromInstant())
            ->where('pr.created_at', '<', $context->toInstant());
        $context->scopeBranches($query, 'pr.branch_id');

        return $query->when($context->param('supplier_id'), fn (Builder $q, string $id) => $q->where('pr.supplier_id', $id))
            ->when($context->param('product_id'), fn (Builder $q, string $id) => $q->where('pv.product_id', $id));
    }
}
