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
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * R1: till returns completed in the period (`decided_at`), exchanges included (counted in
 * `exchanges` too), per return reason, product or cashier (the user who took the return).
 *   returns            distinct returns; quantity = Σ returned quantity
 *   value_refunded     handed back (cash, card, points, store credit, gift card or the value of
 *                      an exchange); credited = set against the invoice's dues. Per product a
 *                      return's refunded / credited totals are shared over its lines by line total.
 *   restocked / written off   quantities put back on the shelf / written off
 *   top_reason         the reason of most returns in the group (ties: by name)
 * Web returns are not included (see the sales reports for their value).
 */
class ReturnsReport implements Report
{
    private const GROUPS = ['reason' => 'Reason', 'product' => 'Product', 'cashier' => 'Cashier'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'returns',
            title: 'Returns',
            description: 'Till returns and exchanges per reason, product or cashier: quantity, value refunded or credited, restocked or written off.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::groupBy(self::GROUPS, 'reason')],
            columns: [
                ReportColumn::text('group', 'Group'),
                ReportColumn::number('returns', 'Returns'),
                ReportColumn::number('exchanges', 'Exchanges'),
                ReportColumn::quantity('quantity', 'Quantity'),
                ReportColumn::money('value_refunded', 'Refunded'),
                ReportColumn::money('credited', 'Credited to account'),
                ReportColumn::quantity('restocked_quantity', 'Restocked'),
                ReportColumn::quantity('written_off_quantity', 'Written off'),
                ReportColumn::text('top_reason', 'Top reason'),
            ],
            defaultSort: '-value_refunded',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $groupBy = (string) $context->param('group_by', 'reason');
        $expression = match ($groupBy) {
            'product' => 'pv.product_id',
            'cashier' => 'r.requested_by',
            default => 'r.return_reason_id',
        };
        $measures = 'COUNT(DISTINCT r.id) as returns, COUNT(DISTINCT CASE WHEN r.exchange_sale_id IS NOT NULL THEN r.id END) as exchanges, SUM(rl.quantity) as quantity, '
            .'SUM(CASE WHEN r.total = 0 THEN 0 ELSE rl.line_total * r.refunded_total / r.total END) as refunded, '
            .'SUM(CASE WHEN r.total = 0 THEN 0 ELSE rl.line_total * r.credited_total / r.total END) as credited, '
            .'SUM(CASE WHEN '.$context->sql->isTrue('rl.restock').' THEN rl.quantity ELSE 0 END) as restocked, '
            .'SUM(CASE WHEN '.$context->sql->isTrue('rl.restock').' THEN 0 ELSE rl.quantity END) as written_off';

        $groups = $this->base($context)->groupByRaw($expression)->selectRaw($expression.' as group_id, '.$measures)->get();
        $total = $this->base($context)->selectRaw($measures)->first();
        $reasonCounts = $this->base($context)->groupByRaw($expression)->groupBy('r.return_reason_id')
            ->selectRaw($expression.' as group_id, r.return_reason_id as reason_id, COUNT(DISTINCT r.id) as n')->get();
        $allReasons = $this->base($context)->groupBy('r.return_reason_id')->selectRaw('r.return_reason_id as reason_id, COUNT(DISTINCT r.id) as n')->get();

        $reasons = Names::of('return_reason', $context->organizationId, $allReasons->pluck('reason_id'));
        $reasonName = fn (?string $id) => $id === null ? 'No reason' : ($reasons[$id] ?? 'Unknown reason');
        $top = function (iterable $counts) use ($reasonName): ?string {
            $best = null;
            foreach ($counts as $c) {
                $candidate = [(int) $c->n, $reasonName($c->reason_id)];
                if ($best === null || $candidate[0] > $best[0] || ($candidate[0] === $best[0] && strcasecmp($candidate[1], $best[1]) < 0)) {
                    $best = $candidate;
                }
            }

            return $best[1] ?? null;
        };
        $topByGroup = $reasonCounts->groupBy(fn ($c) => (string) $c->group_id)->map($top);

        $names = match ($groupBy) {
            'product' => Names::of('product', $context->organizationId, $groups->pluck('group_id')),
            'cashier' => Names::of('user', $context->organizationId, $groups->pluck('group_id')),
            default => $reasons,
        };
        $rows = $groups->map(fn ($g) => [
            'group_id' => $g->group_id,
            'group' => $g->group_id === null ? ($groupBy === 'reason' ? 'No reason' : 'Unknown') : ($names[$g->group_id] ?? 'Unknown'),
        ] + self::figures($g) + ['top_reason' => $topByGroup[(string) $g->group_id] ?? null])->all();

        $totals = self::figures($total ?? (object) []) + ['top_reason' => $top($allReasons)];

        return ReportResult::rows($rows, $totals, ['group' => self::GROUPS[$groupBy] ?? 'Reason']);
    }

    /**
     * @return array<string, mixed>
     */
    private static function figures(object $g): array
    {
        return [
            'returns' => (int) ($g->returns ?? 0),
            'exchanges' => (int) ($g->exchanges ?? 0),
            'quantity' => Sql::quantity($g->quantity ?? null),
            'value_refunded' => Sql::money($g->refunded ?? null),
            'credited' => Sql::money($g->credited ?? null),
            'restocked_quantity' => Sql::quantity($g->restocked ?? null),
            'written_off_quantity' => Sql::quantity($g->written_off ?? null),
        ];
    }

    private function base(ReportContext $context): Builder
    {
        $query = DB::table('sale_return_lines as rl')
            ->join('sale_returns as r', 'r.id', '=', 'rl.sale_return_id')
            ->join('product_variants as pv', 'pv.id', '=', 'rl.variant_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.status', 'completed')
            ->where('r.decided_at', '>=', $context->fromInstant())
            ->where('r.decided_at', '<', $context->toInstant());
        $context->scopeBranches($query, 'r.branch_id');

        return $query;
    }
}
