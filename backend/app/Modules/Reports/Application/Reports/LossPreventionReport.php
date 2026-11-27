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
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * R1 loss prevention: what each cashier gave away or took back at the till in the period.
 * Events (each attributed to a cashier, dated by when it happened):
 *   cancelled sale  sales cancelled in the period (`cancelled_at`), against the cashier who rang
 *                   them up (`created_by`); value = the sale's total;
 *   discount        completed sales of the period (`sold_at`) with item + invoice discounts
 *                   (`item_discount_total + invoice_discount_total`, promotions included);
 *   price override  lines of those sales sold below their list price by an override
 *                   (`price_source = override`): value = (list − unit) × quantity;
 *   no sale         drawer openings without a sale (POS1d), against the user who opened it;
 *   return          completed till returns (`decided_at`), against the user who took them
 *                   (`requested_by`); value = refunded total (credited-to-dues part excluded);
 *   exchange        completed returns of an exchange (POS1c), counted apart from returns.
 * `show=summary`: one row per cashier with counts and values, plus totals;
 * `show=events`: every event in time order (date, cashier, type, document, amount, reason).
 */
class LossPreventionReport implements Report
{
    public const SUMMARY = ['cashier', 'cancelled_count', 'cancelled_value', 'discounts', 'overrides_count', 'overrides_value', 'no_sales', 'returns_count', 'returns_value', 'exchanges'];

    public const EVENTS = ['date', 'cashier', 'event', 'document', 'amount', 'reason'];

    private const TYPES = ['cancelled_sale' => 'Cancelled sale', 'discount' => 'Discount', 'price_override' => 'Price override',
        'no_sale' => 'No sale', 'return' => 'Return', 'exchange' => 'Exchange'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'loss_prevention',
            title: 'Loss prevention',
            description: 'Per cashier: cancelled sales, discounts, price overrides below list, no-sale drawer openings, returns and exchanges — or every event.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [
                ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::cashier(),
                ReportParam::enum('show', 'Show', ['summary' => 'Summary per cashier', 'events' => 'Every event'], 'summary'),
            ],
            columns: [
                ReportColumn::dateTime('date', 'Date'),
                ReportColumn::text('cashier', 'Cashier'),
                ReportColumn::text('event', 'Type'),
                ReportColumn::text('document', 'Document'),
                ReportColumn::money('amount', 'Amount'),
                ReportColumn::text('reason', 'Reason', sortable: false),
                ReportColumn::number('cancelled_count', 'Cancelled sales'),
                ReportColumn::money('cancelled_value', 'Cancelled value'),
                ReportColumn::money('discounts', 'Discounts given'),
                ReportColumn::number('overrides_count', 'Price overrides'),
                ReportColumn::money('overrides_value', 'Given away by overrides'),
                ReportColumn::number('no_sales', 'No-sale openings'),
                ReportColumn::number('returns_count', 'Returns'),
                ReportColumn::money('returns_value', 'Refunded'),
                ReportColumn::number('exchanges', 'Exchanges'),
            ],
            // Events read in time order; summary rows (no date) keep their cashier order.
            defaultSort: 'date',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $events = [
            ...$this->cancelled($context),
            ...$this->discounts($context),
            ...$this->overrides($context),
            ...$this->noSales($context),
            ...$this->returns($context),
        ];
        $names = Names::of('user', $context->organizationId, [...array_column($events, 'cashier_id'), ...array_column($events, 'by')]);

        if ($context->param('show') === 'events') {
            usort($events, fn (array $a, array $b) => [$a['at'], $a['document']] <=> [$b['at'], $b['document']]);
            $rows = array_map(fn (array $e) => [
                'date' => CarbonImmutable::parse($e['at'], 'UTC')->setTimezone($context->timezone)->toIso8601String(),
                'cashier_id' => $e['cashier_id'],
                'cashier' => $e['cashier_id'] === null ? 'Unknown user' : ($names[$e['cashier_id']] ?? 'Unknown user'),
                'event_type' => $e['type'],
                'event' => self::TYPES[$e['type']],
                'document_type' => $e['document_type'],
                'document_id' => $e['document_id'],
                'document' => $e['document'],
                'amount' => $e['amount'],
                'reason' => self::reason($e, $names),
            ], $events);

            return ReportResult::rows($rows, null, columns: self::EVENTS);
        }

        $zero = ['cancelled_count' => 0, 'cancelled_value' => '0.00', 'discounts' => '0.00', 'overrides_count' => 0, 'overrides_value' => '0.00',
            'no_sales' => 0, 'returns_count' => 0, 'returns_value' => '0.00', 'exchanges' => 0];
        [$count, $value] = [
            ['cancelled_sale' => 'cancelled_count', 'price_override' => 'overrides_count', 'no_sale' => 'no_sales', 'return' => 'returns_count', 'exchange' => 'exchanges'],
            ['cancelled_sale' => 'cancelled_value', 'discount' => 'discounts', 'price_override' => 'overrides_value', 'return' => 'returns_value'],
        ];
        $rows = [];
        $totals = $zero;
        foreach ($events as $e) {
            $key = $e['cashier_id'] ?? '';
            $rows[$key] ??= ['cashier_id' => $e['cashier_id'], 'cashier' => $names[$key] ?? 'Unknown user'] + $zero;
            if (isset($count[$e['type']])) {
                $rows[$key][$count[$e['type']]]++;
                $totals[$count[$e['type']]]++;
            }
            if (isset($value[$e['type']])) {
                $rows[$key][$value[$e['type']]] = Decimal::add($rows[$key][$value[$e['type']]], $e['amount'], 2);
                $totals[$value[$e['type']]] = Decimal::add($totals[$value[$e['type']]], $e['amount'], 2);
            }
        }
        uasort($rows, fn (array $a, array $b) => [mb_strtolower($a['cashier']), $a['cashier_id']] <=> [mb_strtolower($b['cashier']), $b['cashier_id']]);

        return ReportResult::rows(array_values($rows), $totals, columns: self::SUMMARY);
    }

    /**
     * @param  array<string, mixed>  $e
     * @param  array<string, string>  $names
     */
    private static function reason(array $e, array $names): ?string
    {
        $by = $e['by'] === null ? null : ($names[$e['by']] ?? 'Unknown user');
        $parts = array_values(array_filter([
            $e['reason'] === null || trim((string) $e['reason']) === '' ? null : trim((string) $e['reason']),
            $by === null ? null : ($e['type'] === 'cancelled_sale' ? 'cancelled by ' : 'approved by ').$by,
        ]));

        return $parts === [] ? null : ucfirst(implode(' · ', $parts));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function cancelled(ReportContext $context): array
    {
        $query = DB::table('sales as s')
            ->where('s.organization_id', $context->organizationId)
            ->where('s.status', 'cancelled')
            ->where('s.cancelled_at', '>=', $context->fromInstant())
            ->where('s.cancelled_at', '<', $context->toInstant());
        $this->scope($query, $context, 's.branch_id', 's.created_by');

        return $query->get(['s.id', 's.number', 's.created_by', 's.cancelled_at', 's.total', 's.cancellation_reason', 's.cancelled_by'])
            ->map(fn ($s) => self::event('cancelled_sale', $s->cancelled_at, $s->created_by, 'sale', $s->id, $s->number, Sql::money($s->total), $s->cancellation_reason, $s->cancelled_by))
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function discounts(ReportContext $context): array
    {
        $query = $this->completedSales($context)->whereRaw('s.item_discount_total + s.invoice_discount_total > 0');

        return $query->get(['s.id', 's.number', 's.created_by', 's.sold_at', 's.item_discount_total', 's.invoice_discount_total', 's.discount_approved_by'])
            ->map(fn ($s) => self::event('discount', $s->sold_at, $s->created_by, 'sale', $s->id, $s->number,
                Decimal::add(Sql::money($s->item_discount_total), Sql::money($s->invoice_discount_total), 2), null, $s->discount_approved_by))
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function overrides(ReportContext $context): array
    {
        $query = $this->completedSales($context)
            ->join('sale_lines as sl', 'sl.sale_id', '=', 's.id')
            ->where('sl.price_source', 'override')
            ->whereNotNull('sl.list_price')
            ->whereColumn('sl.list_price', '>', 'sl.unit_price')
            ->orderBy('sl.position');

        return $query->get(['s.id', 's.number', 's.created_by', 's.sold_at', 'sl.product_name', 'sl.variant_name', 'sl.list_price', 'sl.unit_price', 'sl.quantity', 'sl.price_approved_by'])
            ->map(function ($l) {
                $given = Decimal::round(Decimal::mul(Decimal::sub(Sql::plain($l->list_price), Sql::plain($l->unit_price), 2), Sql::plain($l->quantity), 6), 2);
                $product = $l->variant_name !== null && $l->variant_name !== '' ? $l->product_name.' — '.$l->variant_name : $l->product_name;
                $quantity = Decimal::isWhole(Sql::plain($l->quantity)) ? Decimal::round(Sql::plain($l->quantity), 0) : Sql::quantity($l->quantity);

                return self::event('price_override', $l->sold_at, $l->created_by, 'sale', $l->id, $l->number, $given,
                    $product.': '.Sql::money($l->list_price).' → '.Sql::money($l->unit_price).' × '.$quantity, $l->price_approved_by);
            })
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function noSales(ReportContext $context): array
    {
        $query = DB::table('pos_drawer_openings as d')
            ->where('d.organization_id', $context->organizationId)
            ->where('d.opened_at', '>=', $context->fromInstant())
            ->where('d.opened_at', '<', $context->toInstant());
        $this->scope($query, $context, 'd.branch_id', 'd.user_id');

        return $query->get(['d.id', 'd.user_id', 'd.opened_at', 'd.reason', 'd.approved_by', 'd.register_session_id', 'd.register_session_number'])
            ->map(fn ($d) => self::event('no_sale', $d->opened_at, $d->user_id, $d->register_session_id === null ? null : 'register_session', $d->register_session_id,
                $d->register_session_number, null, $d->reason, $d->approved_by))
            ->all();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function returns(ReportContext $context): array
    {
        $query = DB::table('sale_returns as r')
            ->leftJoin('return_reasons as rr', 'rr.id', '=', 'r.return_reason_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.status', 'completed')
            ->where('r.decided_at', '>=', $context->fromInstant())
            ->where('r.decided_at', '<', $context->toInstant());
        $this->scope($query, $context, 'r.branch_id', 'r.requested_by');

        return $query->get(['r.id', 'r.number', 'r.requested_by', 'r.decided_at', 'r.refunded_total', 'r.exchange_sale_id', 'r.decided_by', 'rr.name as reason'])
            ->map(fn ($r) => self::event($r->exchange_sale_id === null ? 'return' : 'exchange', $r->decided_at, $r->requested_by, 'sale_return', $r->id, $r->number,
                Sql::money($r->refunded_total), $r->reason, $r->decided_by === $r->requested_by ? null : $r->decided_by))
            ->all();
    }

    private function completedSales(ReportContext $context): Builder
    {
        $query = DB::table('sales as s')
            ->where('s.organization_id', $context->organizationId)
            ->where('s.status', 'completed')
            ->where('s.sold_at', '>=', $context->fromInstant())
            ->where('s.sold_at', '<', $context->toInstant());
        $this->scope($query, $context, 's.branch_id', 's.created_by');

        return $query;
    }

    private function scope(Builder $query, ReportContext $context, string $branchColumn, string $cashierColumn): void
    {
        $context->scopeBranches($query, $branchColumn);
        $query->when($context->param('cashier_id'), fn (Builder $q, string $id) => $q->where($cashierColumn, $id));
    }

    /**
     * @return array<string, mixed>
     */
    private static function event(string $type, mixed $at, ?string $cashierId, ?string $documentType, ?string $documentId, ?string $document, ?string $amount, ?string $reason, ?string $by): array
    {
        return [
            'type' => $type,
            'at' => CarbonImmutable::parse((string) $at, 'UTC')->utc()->toIso8601String(),
            'cashier_id' => $cashierId,
            'document_type' => $documentType,
            'document_id' => $documentId,
            'document' => $document,
            'amount' => $amount,
            'reason' => $reason,
            'by' => $by,
        ];
    }
}
