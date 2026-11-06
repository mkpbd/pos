<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\RequisitionQuantities;
use App\Modules\Purchasing\Domain\Procurement\ApprovalPolicy;
use App\Modules\Purchasing\Domain\Procurement\QuoteStatus;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionLine;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqAward;
use App\Modules\Purchasing\Infrastructure\Models\RfqLine;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Purchasing\Infrastructure\Models\SupplierQuoteLine;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Awards a sent RFQ (SC2), in one transaction: every awarded line (split awards allowed —
 * several suppliers per line, quantities adding up to at most the requested quantity) goes
 * into one draft purchase order per supplier at the quoted unit price (SavePurchaseOrder:
 * server totals, numbering, audit). When the RFQ came from an approved requisition, each
 * order is pre-approved for the requisition's estimate of what it covers (5 % rule at
 * submit); otherwise it follows the normal PO approval. Optionally the supplier catalog
 * takes the quoted cost and lead time (SC1 rows updated or created). Unawarded requisition
 * quantities are given back. The RFQ becomes `awarded`.
 */
class AwardRfq
{
    public function __construct(
        private readonly SavePurchaseOrder $save,
        private readonly ManageSupplierCatalog $catalog,
        private readonly ProductDirectory $products,
        private readonly SupplierDirectory $suppliers,
        private readonly OrganizationDate $dates,
        private readonly RequisitionQuantities $quantities,
        private readonly ProcurementHistory $history,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{lines: list<array{rfq_line_id: string, supplier_id: string, quantity: string}>, update_catalog?: ?bool}  $data
     * @return array{rfq: Rfq, orders: list<PurchaseOrder>, catalog_updated: int}
     */
    public function __invoke(TenantUser $actor, Rfq $rfq, array $data): array
    {
        return DB::transaction(function () use ($actor, $rfq, $data) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== RfqStatus::Sent) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "RFQ {$locked->number} is {$locked->status->value}; only a sent RFQ can be awarded.", ['from' => $locked->status->value, 'to' => 'awarded']);
            }

            $awards = $this->validate($locked, array_values($data['lines']));
            $requisition = $locked->requisition_id === null ? null : PurchaseRequisition::query()->whereKey($locked->requisition_id)->first();
            $approved = $requisition !== null && $requisition->isApproved();
            $requisitionLines = $approved
                ? PurchaseRequisitionLine::query()->where('purchase_requisition_id', $requisition->id)->get()->keyBy('id')
                : collect();

            $today = CarbonImmutable::parse($this->dates->today());
            $groups = [];
            foreach ($awards as $award) {
                $groups[$award['supplier_id']][] = $award;
            }

            $orders = [];
            foreach ($groups as $supplierId => $supplierAwards) {
                $lead = max(array_map(fn (array $a) => $a['lead_time_days'], $supplierAwards));
                $expected = $locked->needed_by !== null && $locked->needed_by->toDateString() >= $today->toDateString()
                    ? $locked->needed_by->toDateString()
                    : $today->addDays($lead)->toDateString();

                $order = ($this->save)($actor, null, [
                    'supplier_id' => $supplierId,
                    'store_id' => $locked->store_id,
                    'order_date' => $today->toDateString(),
                    'expected_date' => $expected,
                    'notes' => "Awarded from {$locked->number}.",
                    'lines' => array_map(fn (array $a) => [
                        'variant_id' => $a['variant_id'],
                        'quantity' => $a['quantity'],
                        'unit_cost' => $a['unit_price'],
                        'requisition_line_id' => $a['requisition_line_id'],
                    ], $supplierAwards),
                ]);

                $approvedAmount = null;
                if ($approved) {
                    foreach ($supplierAwards as $a) {
                        $reqLine = $a['requisition_line_id'] === null ? null : $requisitionLines->get($a['requisition_line_id']);
                        if ($reqLine instanceof PurchaseRequisitionLine) {
                            $approvedAmount = Decimal::add($approvedAmount ?? '0', ApprovalPolicy::share($reqLine->line_total, $a['quantity'], $reqLine->quantity), 2);
                        }
                    }
                }
                $order->forceFill(['rfq_id' => $locked->id, 'requisition_id' => $locked->requisition_id, 'approved_amount' => $approvedAmount])->save();

                foreach ($supplierAwards as $a) {
                    RfqAward::query()->create([
                        'organization_id' => $locked->organization_id,
                        'rfq_id' => $locked->id,
                        'rfq_line_id' => $a['rfq_line_id'],
                        'supplier_id' => $supplierId,
                        'purchase_order_id' => $order->id,
                        'quantity' => $a['quantity'],
                        'unit_price' => $a['unit_price'],
                        'created_at' => now(),
                    ]);
                }
                $orders[] = $order;
            }

            $updated = ($data['update_catalog'] ?? false) ? $this->updateCatalog($awards) : 0;

            $locked->forceFill(['status' => RfqStatus::Awarded, 'awarded_at' => now()])->save();
            $awardedByLine = [];
            foreach ($awards as $a) {
                $awardedByLine[$a['rfq_line_id']] = Decimal::add($awardedByLine[$a['rfq_line_id']] ?? '0', $a['quantity'], 3);
            }
            $this->quantities->release($locked, $awardedByLine, 'not awarded');
            $numbers = implode(', ', array_map(fn (PurchaseOrder $o) => $o->number, $orders));
            $this->history->rfq($locked, RfqStatus::Sent->value, RfqStatus::Awarded->value, "Purchase orders {$numbers}.");
            $this->audit->record('rfq.awarded', $locked, ['status' => 'sent'], [
                'status' => 'awarded',
                'purchase_orders' => array_map(fn (PurchaseOrder $o) => $o->number, $orders),
                'catalog_updated' => $updated,
            ]);

            return ['rfq' => $locked, 'orders' => $orders, 'catalog_updated' => $updated];
        });
    }

    /**
     * @param  list<array{rfq_line_id: string, supplier_id: string, quantity: string}>  $lines
     * @return list<array{rfq_line_id: string, supplier_id: string, quantity: string, variant_id: string, unit_price: string, lead_time_days: int, quoted_lead_time: ?int, requisition_line_id: ?string}>
     */
    private function validate(Rfq $rfq, array $lines): array
    {
        $rfqLines = $rfq->lines()->get()->keyBy('id');
        $invited = $rfq->suppliers()->with('quote.lines')->get()->keyBy('supplier_id');
        $variants = $this->products->variants($rfq->organization_id, $rfqLines->pluck('variant_id')->all());
        $contacts = $this->suppliers->contacts($rfq->organization_id, array_values(array_unique(array_column($lines, 'supplier_id'))));
        $catalogLeads = SupplierProduct::query()
            ->whereIn('supplier_id', array_column($lines, 'supplier_id'))
            ->whereIn('variant_id', $rfqLines->pluck('variant_id')->all())
            ->get(['supplier_id', 'variant_id', 'lead_time_days'])
            ->mapWithKeys(fn (SupplierProduct $p) => [$p->supplier_id.'|'.$p->variant_id => $p->lead_time_days]);

        $errors = [];
        $seen = [];
        $totals = [];
        $awards = [];
        foreach ($lines as $i => $line) {
            /** @var RfqLine|null $rfqLine */
            $rfqLine = $rfqLines->get($line['rfq_line_id']);
            if ($rfqLine === null) {
                $errors["lines.{$i}.rfq_line_id"] = ['This line is not part of the RFQ.'];

                continue;
            }
            $variant = $variants[$rfqLine->variant_id] ?? null;
            $supplier = $contacts[$line['supplier_id']] ?? null;
            /** @var RfqSupplier|null $rfqSupplier */
            $rfqSupplier = $invited->get($line['supplier_id']);
            $quote = $rfqSupplier?->quote;
            /** @var SupplierQuoteLine|null $price */
            $price = $quote !== null && $quote->status === QuoteStatus::Received
                ? $quote->lines->firstWhere('rfq_line_id', $rfqLine->id)
                : null;
            $pair = $line['supplier_id'].'|'.$rfqLine->id;

            if ($rfqSupplier === null) {
                $errors["lines.{$i}.supplier_id"] = ['This supplier was not invited to the RFQ.'];
            } elseif ($price === null) {
                $errors["lines.{$i}.supplier_id"] = [($supplier['name'] ?? 'This supplier').' did not quote this line.'];
            } elseif ($supplier === null || $supplier['archived'] || ! $supplier['is_active']) {
                $errors["lines.{$i}.supplier_id"] = [($supplier['name'] ?? 'This supplier').' is inactive or archived.'];
            } elseif (isset($seen[$pair])) {
                $errors["lines.{$i}.supplier_id"] = ['Each supplier may be awarded a line only once.'];
            }
            $seen[$pair] = true;

            $quantity = Decimal::round((string) $line['quantity'], 3);
            if ($variant !== null && ! $variant['allow_decimal'] && ! Decimal::isWhole($quantity)) {
                $errors["lines.{$i}.quantity"] = ["{$variant['product_name']} is bought in whole units ({$variant['unit_code']})."];
            }
            $totals[$rfqLine->id] = Decimal::add($totals[$rfqLine->id] ?? '0', $quantity, 3);
            if (Decimal::compare($totals[$rfqLine->id], $rfqLine->quantity) > 0) {
                $errors["lines.{$i}.quantity"] = ["Only {$rfqLine->quantity} requested on the RFQ for this line."];
            }

            if ($price !== null) {
                $awards[] = [
                    'rfq_line_id' => $rfqLine->id,
                    'supplier_id' => $line['supplier_id'],
                    'quantity' => $quantity,
                    'variant_id' => $rfqLine->variant_id,
                    'unit_price' => $price->unit_price,
                    'quoted_lead_time' => $price->lead_time_days,
                    'lead_time_days' => $price->lead_time_days ?? $catalogLeads[$line['supplier_id'].'|'.$rfqLine->variant_id] ?? SupplierProduct::DEFAULT_LEAD_TIME_DAYS,
                    'requisition_line_id' => $rfqLine->requisition_line_id,
                ];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $awards;
    }

    /**
     * Quoted cost (and lead time, when quoted) into the supplier catalog.
     *
     * @param  list<array{supplier_id: string, variant_id: string, unit_price: string, quoted_lead_time: ?int}>  $awards
     */
    private function updateCatalog(array $awards): int
    {
        $count = 0;
        foreach ($awards as $a) {
            $fields = ['unit_cost' => $a['unit_price']] + ($a['quoted_lead_time'] === null ? [] : ['lead_time_days' => $a['quoted_lead_time']]);
            $row = SupplierProduct::query()->where('supplier_id', $a['supplier_id'])->where('variant_id', $a['variant_id'])->first();
            if ($row !== null) {
                $this->catalog->update($row, $fields);
            } else {
                $this->catalog->create(['supplier_id' => $a['supplier_id'], 'variant_id' => $a['variant_id']] + $fields);
            }
            $count++;
        }

        return $count;
    }
}
