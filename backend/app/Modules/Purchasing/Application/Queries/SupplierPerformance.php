<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Domain\Performance\SupplierScore;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * SC3: supplier performance read model (no writes). Business dates are the organization's
 * (order, invoice and voucher dates as stored; RFQ send and award times converted to the
 * organization's timezone). Branch scope: the user's branches, optionally one branch.
 *
 * Per supplier, over [date_from, date_to]:
 * - orders: purchase orders placed (ordered_at set) with order_date in range;
 * - spend: Σ payable totals of its receipts (invoice date in range) + Σ receipt charges it
 *   billed (amount + tax, receipt invoice date in range) + Σ posted landed cost vouchers it
 *   billed (voucher date in range);
 * - on_time_rate: of those orders with an expected date and at least one receipt, the % whose
 *   delivery date was on or before the expected date — the completing receipt for a fully
 *   received order, the first receipt otherwise (a receipt's date is its invoice date);
 * - fill_rate: Σ received ÷ Σ ordered (base quantities) over those orders that are received,
 *   still open past their expected date, or cancelled after a partial receipt;
 * - avg_lead_days: mean days from order date to first receipt (orders with a receipt);
 * - return_rate: Σ returned ÷ Σ received quantity on its receipts in range;
 * - price_change_pct: per variant, average unit cost (Σ line subtotal ÷ Σ quantity) of its
 *   receipts in range vs the previous period of the same length, as a % change, weighted by
 *   the variant's spend in range; null without a variant bought in both periods;
 * - quote_response_rate: quotes recorded (received or declined) ÷ RFQ invitations sent in range;
 * - quotes_won: RFQ lines awarded to it in range;
 * - score: SupplierScore.
 */
class SupplierPerformance
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SupplierDirectory $suppliers,
        private readonly OrganizationDate $dates,
    ) {}

    /**
     * @return array{date_from: string, date_to: string, previous_from: string, previous_to: string}
     */
    public function period(?string $from, ?string $to): array
    {
        $to ??= $this->dates->today();
        $from ??= CarbonImmutable::parse($to)->subDays(89)->toDateString();
        $days = CarbonImmutable::parse($from)->diffInDays(CarbonImmutable::parse($to)) + 1;
        $previousTo = CarbonImmutable::parse($from)->subDay();

        return [
            'date_from' => $from,
            'date_to' => $to,
            'previous_from' => $previousTo->subDays((int) $days - 1)->toDateString(),
            'previous_to' => $previousTo->toDateString(),
        ];
    }

    /**
     * @param  array{date_from: string, date_to: string, previous_from: string, previous_to: string}  $period
     * @return list<array<string, mixed>>
     */
    public function list(TenantUser $user, array $period, ?string $branchId, ?string $supplierId, string $sort = '-score'): array
    {
        $data = $this->collect($user, $period['previous_from'], $period['date_to'], $branchId, $supplierId === null ? null : [$supplierId]);
        $summaries = $this->suppliers->summaries($this->tenant->requireOrganization(), array_keys($data));

        $rows = [];
        foreach ($data as $id => $items) {
            if (! isset($summaries[$id])) {
                continue;
            }
            $metrics = $this->metrics($items, $period['date_from'], $period['date_to'], $period);
            if ($metrics['active']) {
                unset($metrics['active']);
                $rows[] = ['supplier' => $summaries[$id]] + $metrics;
            }
        }

        return $this->sort($rows, $sort);
    }

    /**
     * @param  array{date_from: string, date_to: string, previous_from: string, previous_to: string}  $period
     * @return array<string, mixed>
     */
    public function detail(TenantUser $user, string $supplierId, array $period, ?string $branchId): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $supplier = $this->suppliers->find($supplierId, $organizationId) ?? throw new NotFoundHttpException;
        $lastMonth = CarbonImmutable::parse($period['date_to'])->startOfMonth();
        $firstMonth = $lastMonth->subMonths(11);
        $start = min($period['previous_from'], $firstMonth->toDateString());
        $items = $this->collect($user, $start, $period['date_to'], $branchId, [$supplierId])[$supplierId] ?? self::empty();

        $metrics = $this->metrics($items, $period['date_from'], $period['date_to'], $period);
        unset($metrics['active']);

        $trend = [];
        for ($month = $firstMonth; $month <= $lastMonth; $month = $month->addMonth()) {
            $monthFrom = $month->toDateString();
            $monthTo = min($month->endOfMonth()->toDateString(), $period['date_to']);
            $m = $this->metrics($items, $monthFrom, $monthTo, null);
            $trend[] = [
                'month' => $month->format('Y-m'),
                'orders' => $m['orders'],
                'on_time_rate' => $m['on_time_rate'],
                'fill_rate' => $m['fill_rate'],
                'spend' => $m['spend'],
            ];
        }

        $issues = array_values(array_filter(
            $items['orders'],
            fn (array $o) => $o['order_date'] >= $firstMonth->toDateString() && $o['order_date'] <= $period['date_to'] && ($o['late'] || $o['short']),
        ));
        usort($issues, fn (array $a, array $b) => [$b['expected_date'] ?? $b['order_date'], $b['number']] <=> [$a['expected_date'] ?? $a['order_date'], $a['number']]);

        return [
            'supplier' => ['id' => $supplier['id'], 'code' => $supplier['code'], 'name' => $supplier['name']],
            ...$period,
            'metrics' => $metrics,
            'trend' => $trend,
            'problem_deliveries' => array_map(fn (array $o) => [
                'purchase_order' => ['id' => $o['id'], 'number' => $o['number']],
                'status' => $o['status'],
                'order_date' => $o['order_date'],
                'expected_date' => $o['expected_date'],
                // The delivery date judged against the expected date (see on_time_rate).
                'received_date' => $o['completed_on'] ?? $o['first_received_on'],
                'first_received_on' => $o['first_received_on'],
                'completed_on' => $o['completed_on'],
                'days_late' => $o['days_late'],
                'ordered_quantity' => $o['ordered'],
                'received_quantity' => $o['received'],
                'short_quantity' => $o['short'] ? Decimal::sub($o['ordered'], $o['received'], 3) : '0.000',
                'is_late' => $o['late'],
                'is_short' => $o['short'],
            ], array_slice($issues, 0, 20)),
        ];
    }

    /**
     * Metrics of one supplier over [from, to]; the price change compares with $period's
     * previous range when given (list and headline), and is null in the monthly trend.
     *
     * @param  array<string, list<array<string, mixed>>>  $items
     * @param  array{previous_from: string, previous_to: string}|null  $period
     * @return array<string, mixed>
     */
    private function metrics(array $items, string $from, string $to, ?array $period): array
    {
        $in = fn (string $date) => $date >= $from && $date <= $to;

        $orders = array_values(array_filter($items['orders'], fn (array $o) => $in($o['order_date'])));
        $onTime = array_filter($orders, fn (array $o) => $o['on_time'] !== null);
        $onTimeHits = count(array_filter($onTime, fn (array $o) => $o['on_time']));
        $fill = array_filter($orders, fn (array $o) => $o['fill_eligible']);
        $ordered = array_reduce($fill, fn (string $s, array $o) => Decimal::add($s, $o['ordered'], 3), '0.000');
        $received = array_reduce($fill, fn (string $s, array $o) => Decimal::add($s, $o['received'], 3), '0.000');
        $leads = array_values(array_filter(array_map(fn (array $o) => $o['lead_days'], $orders), fn ($d) => $d !== null));

        $spend = array_reduce(array_filter($items['spend'], fn (array $s) => $in($s['date'])), fn (string $sum, array $s) => Decimal::add($sum, $s['amount'], 2), '0.00');

        $lines = array_filter($items['lines'], fn (array $l) => $in($l['date']));
        $lineQuantity = array_reduce($lines, fn (string $s, array $l) => Decimal::add($s, $l['quantity'], 3), '0.000');
        $lineReturned = array_reduce($lines, fn (string $s, array $l) => Decimal::add($s, $l['returned'], 3), '0.000');

        $invitations = array_filter($items['invitations'], fn (array $i) => $in($i['date']));
        $responses = count(array_filter($invitations, fn (array $i) => $i['responded']));
        $awards = count(array_filter($items['awards'], fn (array $a) => $in($a['date'])));

        $onTimeRate = $onTime === [] ? null : self::percent((string) $onTimeHits, (string) count($onTime));
        $fillRate = Decimal::compare($ordered, '0') > 0 ? self::percent($received, $ordered) : null;
        $returnRate = Decimal::compare($lineQuantity, '0') > 0 ? self::percent($lineReturned, $lineQuantity) : null;
        $priceChange = $period === null ? null : $this->priceChange($items['lines'], $from, $to, $period['previous_from'], $period['previous_to']);
        $responseRate = $invitations === [] ? null : self::percent((string) $responses, (string) count($invitations));
        $score = SupplierScore::compute($onTimeRate, $fillRate, $returnRate, $priceChange, $responseRate);

        return [
            'orders' => count($orders),
            'spend' => $spend,
            'on_time_rate' => $onTimeRate,
            'on_time_orders' => count($onTime),
            'fill_rate' => $fillRate,
            'ordered_quantity' => $ordered,
            'received_quantity' => $received,
            'avg_lead_days' => $leads === [] ? null : Decimal::div((string) array_sum($leads), (string) count($leads), 1),
            'return_rate' => $returnRate,
            'price_change_pct' => $priceChange,
            'quote_invitations' => count($invitations),
            'quote_responses' => $responses,
            'quote_response_rate' => $responseRate,
            'quotes_won' => $awards,
            'late_deliveries' => count(array_filter($orders, fn (array $o) => $o['late'])),
            'short_deliveries' => count(array_filter($orders, fn (array $o) => $o['short'])),
            'score' => $score['score'] === null ? null : (string) $score['score'],
            'score_components' => $score['components'],
            'score_weights' => $score['weights'],
            'active' => $orders !== [] || Decimal::compare($spend, '0') > 0 || $lines !== [] || $invitations !== [] || $awards > 0,
        ];
    }

    /**
     * @param  list<array{date: string, variant_id: string, quantity: string, subtotal: string}>  $lines
     */
    private function priceChange(array $lines, string $from, string $to, string $previousFrom, string $previousTo): ?string
    {
        $sum = function (string $start, string $end) use ($lines): array {
            $byVariant = [];
            foreach ($lines as $l) {
                if ($l['date'] < $start || $l['date'] > $end) {
                    continue;
                }
                $byVariant[$l['variant_id']]['quantity'] = Decimal::add($byVariant[$l['variant_id']]['quantity'] ?? '0', $l['quantity'], 3);
                $byVariant[$l['variant_id']]['value'] = Decimal::add($byVariant[$l['variant_id']]['value'] ?? '0', $l['subtotal'], 2);
            }

            return $byVariant;
        };
        $current = $sum($from, $to);
        $previous = $sum($previousFrom, $previousTo);

        $weighted = '0';
        $weights = '0';
        foreach ($current as $variantId => $now) {
            $before = $previous[$variantId] ?? null;
            if ($before === null || Decimal::compare($before['quantity'], '0') <= 0 || Decimal::compare($before['value'], '0') <= 0 || Decimal::compare($now['quantity'], '0') <= 0) {
                continue;
            }
            $currentAverage = Decimal::div($now['value'], $now['quantity'], 8);
            $previousAverage = Decimal::div($before['value'], $before['quantity'], 8);
            $change = Decimal::mul(Decimal::sub(Decimal::div($currentAverage, $previousAverage, 8), '1', 8), '100', 8);
            $weighted = Decimal::add($weighted, Decimal::mul($change, $now['value'], 8), 8);
            $weights = Decimal::add($weights, $now['value'], 2);
        }

        return Decimal::compare($weights, '0') > 0 ? Decimal::div($weighted, $weights, 2) : null;
    }

    /**
     * Raw facts per supplier between $start and $end (inclusive, organization dates).
     *
     * @param  list<string>|null  $supplierIds
     * @return array<string, array<string, list<array<string, mixed>>>>
     */
    private function collect(TenantUser $user, string $start, string $end, ?string $branchId, ?array $supplierIds): array
    {
        $org = $this->tenant->requireOrganization();
        $endExclusive = CarbonImmutable::parse($end)->addDay()->toDateString();
        $today = $this->dates->today();
        $branches = $user->accessibleBranchIds();
        if ($branchId !== null) {
            $branches = $branches === null || in_array($branchId, $branches, true) ? [$branchId] : [];
        }
        $scope = fn (Builder $q, string $column) => $branches === null ? $q : $q->whereIn($column, $branches);
        $suppliers = fn (Builder $q, string $column) => $supplierIds === null ? $q : $q->whereIn($column, $supplierIds);
        $data = [];
        $add = function (string $supplierId, string $kind, array $item) use (&$data) {
            $data[$supplierId] ??= self::empty();
            $data[$supplierId][$kind][] = $item;
        };

        // Orders placed in range, with ordered/received quantities and their receipts.
        $orders = DB::table('purchase_orders')
            ->where('organization_id', $org)->whereNotNull('ordered_at')
            ->where('order_date', '>=', $start)->where('order_date', '<', $endExclusive)
            ->tap(fn (Builder $q) => $scope($q, 'branch_id'))->tap(fn (Builder $q) => $suppliers($q, 'supplier_id'))
            ->get(['id', 'number', 'supplier_id', 'status', 'order_date', 'expected_date']);
        $orderIds = $orders->pluck('id')->all();
        $quantities = $orderIds === [] ? collect() : DB::table('purchase_order_lines')
            ->whereIn('purchase_order_id', $orderIds)
            ->groupBy('purchase_order_id')
            ->get(['purchase_order_id', DB::raw('SUM(quantity) as ordered'), DB::raw('SUM(CASE WHEN received_quantity > quantity THEN quantity ELSE received_quantity END) as received')])
            ->keyBy('purchase_order_id');
        $receipts = $orderIds === [] ? collect() : DB::table('goods_receipts as r')
            ->join('goods_receipt_lines as l', 'l.goods_receipt_id', '=', 'r.id')
            ->where('r.organization_id', $org)
            ->whereIn('r.purchase_order_id', $orderIds)
            ->whereNotNull('l.purchase_order_line_id')
            ->groupBy('r.id', 'r.purchase_order_id', 'r.invoice_date', 'r.created_at')
            ->orderBy('r.invoice_date')->orderBy('r.created_at')
            ->get(['r.purchase_order_id', 'r.invoice_date', DB::raw('SUM(l.quantity) as quantity')])
            ->groupBy('purchase_order_id');
        foreach ($orders as $order) {
            $add($order->supplier_id, 'orders', $this->order($order, $quantities[$order->id] ?? null, $receipts[$order->id] ?? collect(), $today));
        }

        // Spend: receipts (payable total), charges billed on receipts, posted vouchers.
        DB::table('goods_receipts')
            ->where('organization_id', $org)->where('invoice_date', '>=', $start)->where('invoice_date', '<', $endExclusive)
            ->tap(fn (Builder $q) => $scope($q, 'branch_id'))->tap(fn (Builder $q) => $suppliers($q, 'supplier_id'))
            ->get(['supplier_id', 'invoice_date', 'payable_total'])
            ->each(fn ($r) => $add($r->supplier_id, 'spend', ['date' => self::date($r->invoice_date), 'amount' => Decimal::round((string) $r->payable_total, 2)]));
        DB::table('goods_receipt_charges as c')
            ->join('goods_receipts as r', 'r.id', '=', 'c.goods_receipt_id')
            ->where('c.organization_id', $org)->whereNotNull('c.charge_supplier_id')
            ->where('r.invoice_date', '>=', $start)->where('r.invoice_date', '<', $endExclusive)
            ->tap(fn (Builder $q) => $scope($q, 'r.branch_id'))->tap(fn (Builder $q) => $suppliers($q, 'c.charge_supplier_id'))
            ->get(['c.charge_supplier_id', 'r.invoice_date', 'c.amount', 'c.tax_amount'])
            ->each(fn ($c) => $add($c->charge_supplier_id, 'spend', ['date' => self::date($c->invoice_date), 'amount' => Decimal::add((string) $c->amount, (string) $c->tax_amount, 2)]));
        DB::table('landed_cost_vouchers')
            ->where('organization_id', $org)->where('status', 'posted')
            ->where('voucher_date', '>=', $start)->where('voucher_date', '<', $endExclusive)
            ->tap(fn (Builder $q) => $scope($q, 'branch_id'))->tap(fn (Builder $q) => $suppliers($q, 'charge_supplier_id'))
            ->get(['charge_supplier_id', 'voucher_date', 'total'])
            ->each(fn ($v) => $add($v->charge_supplier_id, 'spend', ['date' => self::date($v->voucher_date), 'amount' => Decimal::round((string) $v->total, 2)]));

        // Receipt lines: returns and unit prices.
        DB::table('goods_receipt_lines as l')
            ->join('goods_receipts as r', 'r.id', '=', 'l.goods_receipt_id')
            ->where('r.organization_id', $org)->where('r.invoice_date', '>=', $start)->where('r.invoice_date', '<', $endExclusive)
            ->tap(fn (Builder $q) => $scope($q, 'r.branch_id'))->tap(fn (Builder $q) => $suppliers($q, 'r.supplier_id'))
            ->get(['r.supplier_id', 'r.invoice_date', 'l.variant_id', 'l.quantity', 'l.returned_quantity', 'l.line_subtotal'])
            ->each(fn ($l) => $add($l->supplier_id, 'lines', [
                'date' => self::date($l->invoice_date),
                'variant_id' => $l->variant_id,
                'quantity' => Decimal::round((string) $l->quantity, 3),
                'returned' => Decimal::round((string) $l->returned_quantity, 3),
                'subtotal' => Decimal::round((string) $l->line_subtotal, 2),
            ]));

        // RFQ invitations sent and awards (timestamps → organization dates).
        $timezone = $this->dates->timezone();
        $windowFrom = CarbonImmutable::parse($start, $timezone)->startOfDay()->utc();
        $windowTo = CarbonImmutable::parse($endExclusive, $timezone)->startOfDay()->utc();
        DB::table('rfq_suppliers as s')
            ->join('rfqs as q', 'q.id', '=', 's.rfq_id')
            ->leftJoin('supplier_quotes as sq', 'sq.rfq_supplier_id', '=', 's.id')
            ->where('s.organization_id', $org)->whereNotNull('s.sent_at')
            ->where('s.sent_at', '>=', $windowFrom)->where('s.sent_at', '<', $windowTo)
            ->tap(fn (Builder $q) => $scope($q, 'q.branch_id'))->tap(fn (Builder $q) => $suppliers($q, 's.supplier_id'))
            ->get(['s.supplier_id', 's.sent_at', 'sq.id as quote_id'])
            ->each(fn ($i) => $add($i->supplier_id, 'invitations', ['date' => self::localDate((string) $i->sent_at, $timezone), 'responded' => $i->quote_id !== null]));
        DB::table('rfq_awards as a')
            ->join('rfqs as q', 'q.id', '=', 'a.rfq_id')
            ->where('a.organization_id', $org)
            ->where('a.created_at', '>=', $windowFrom)->where('a.created_at', '<', $windowTo)
            ->tap(fn (Builder $q) => $scope($q, 'q.branch_id'))->tap(fn (Builder $q) => $suppliers($q, 'a.supplier_id'))
            ->get(['a.supplier_id', 'a.created_at'])
            ->each(fn ($a) => $add($a->supplier_id, 'awards', ['date' => self::localDate((string) $a->created_at, $timezone)]));

        return $data;
    }

    /**
     * Per-order delivery facts.
     *
     * @param  Collection<int, object>  $receipts  invoice date order
     * @return array<string, mixed>
     */
    private function order(object $order, ?object $quantities, $receipts, string $today): array
    {
        $ordered = Decimal::round((string) ($quantities->ordered ?? '0'), 3);
        $received = Decimal::round((string) ($quantities->received ?? '0'), 3);
        $orderDate = self::date($order->order_date);
        $expected = $order->expected_date === null ? null : self::date($order->expected_date);

        $first = null;
        $completed = null;
        $cumulative = '0';
        foreach ($receipts as $receipt) {
            $date = self::date($receipt->invoice_date);
            $first ??= $date;
            $cumulative = Decimal::add($cumulative, (string) $receipt->quantity, 3);
            if ($completed === null && Decimal::compare($ordered, '0') > 0 && Decimal::compare($cumulative, $ordered) >= 0) {
                $completed = $date;
            }
        }
        $complete = $order->status === 'received' || ($completed !== null && Decimal::compare($received, $ordered) >= 0);
        $delivered = $complete ? ($completed ?? $first) : $first;

        $onTime = $expected !== null && $delivered !== null ? $delivered <= $expected : null;
        $fillEligible = $order->status === 'received'
            || (in_array($order->status, ['ordered', 'partially_received'], true) && $expected !== null && $expected < $today)
            || ($order->status === 'cancelled' && Decimal::compare($received, '0') > 0);
        $overdueUndelivered = $delivered === null && $expected !== null && $expected < $today && $order->status !== 'cancelled';
        $late = $onTime === false || $overdueUndelivered;
        $lateReference = $delivered ?? ($overdueUndelivered ? $today : null);

        return [
            'id' => $order->id,
            'number' => $order->number,
            'status' => $order->status,
            'order_date' => $orderDate,
            'expected_date' => $expected,
            'first_received_on' => $first,
            'completed_on' => $complete ? ($completed ?? $first) : null,
            'ordered' => $ordered,
            'received' => $received,
            'on_time' => $onTime,
            'fill_eligible' => $fillEligible,
            'lead_days' => $first === null ? null : (int) CarbonImmutable::parse($orderDate)->diffInDays(CarbonImmutable::parse($first)),
            'late' => $late,
            'days_late' => $late && $expected !== null && $lateReference !== null ? (int) CarbonImmutable::parse($expected)->diffInDays(CarbonImmutable::parse($lateReference)) : null,
            'short' => $fillEligible && Decimal::compare($received, $ordered) < 0,
        ];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    private function sort(array $rows, string $sort): array
    {
        $descending = str_starts_with($sort, '-');
        $key = ltrim($sort, '-');
        usort($rows, function (array $a, array $b) use ($key, $descending) {
            $x = $key === 'name' ? $a['supplier']['name'] : $a[$key];
            $y = $key === 'name' ? $b['supplier']['name'] : $b[$key];
            if ($x === null || $y === null) {
                $nulls = ($x === null) <=> ($y === null); // nulls last in both directions
                if ($nulls !== 0) {
                    return $nulls;
                }
            } else {
                $cmp = is_string($x) && is_numeric($x) ? Decimal::compare($x, (string) $y) : $x <=> $y;
                if ($cmp !== 0) {
                    return $descending ? -$cmp : $cmp;
                }
            }

            return strcasecmp($a['supplier']['name'], $b['supplier']['name']);
        });

        return $rows;
    }

    /**
     * @return array<string, list<array<string, mixed>>>
     */
    private static function empty(): array
    {
        return ['orders' => [], 'spend' => [], 'lines' => [], 'invitations' => [], 'awards' => []];
    }

    private static function percent(string $part, string $whole): string
    {
        return Decimal::div(Decimal::mul($part, '100', 6), $whole, 2);
    }

    private static function date(mixed $value): string
    {
        return substr((string) $value, 0, 10);
    }

    private static function localDate(string $timestamp, string $timezone): string
    {
        return CarbonImmutable::parse($timestamp, 'UTC')->setTimezone($timezone)->toDateString();
    }
}
