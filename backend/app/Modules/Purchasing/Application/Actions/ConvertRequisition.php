<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Purchasing\Application\Services\RequisitionQuantities;
use App\Modules\Purchasing\Domain\Procurement\ApprovalPolicy;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionLine;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Turns an approved requisition into draft purchase orders and/or an RFQ (SC2), in one
 * transaction under the requisition's row lock:
 * - purchase order lines are grouped by supplier (chosen per line, default the line's
 *   suggested supplier, else the preferred catalog supplier) at the supplier's catalog cost
 *   (else the requisition's estimate); each order is pre-approved for the requisition's
 *   estimate of the quantities it covers (`approved_amount`, 5 % rule at submit) and linked
 *   to the requisition;
 * - RFQ lines (no supplier needed) go into one draft RFQ linked to the requisition.
 * Each line's quantity defaults to what is still open; the requisition becomes `converted`
 * once every line is fully converted.
 */
class ConvertRequisition
{
    public function __construct(
        private readonly SavePurchaseOrder $save,
        private readonly SaveRfq $rfqs,
        private readonly ReorderSuggestions $suggestions,
        private readonly ProductDirectory $products,
        private readonly SupplierDirectory $suppliers,
        private readonly OrganizationDate $dates,
        private readonly RequisitionQuantities $quantities,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{purchase_orders?: ?array{lines: list<array{requisition_line_id: string, quantity?: ?string, supplier_id?: ?string}>}, rfq?: ?array{lines: list<array{requisition_line_id: string, quantity?: ?string}>, title?: ?string, reply_by?: ?string, notes?: ?string, supplier_ids?: ?list<string>}}  $data
     * @return array{requisition: PurchaseRequisition, orders: list<PurchaseOrder>, rfq: ?Rfq}
     */
    public function __invoke(TenantUser $actor, PurchaseRequisition $requisition, array $data): array
    {
        $poLines = array_values($data['purchase_orders']['lines'] ?? []);
        $rfqLines = array_values($data['rfq']['lines'] ?? []);
        if ($poLines === [] && $rfqLines === []) {
            throw ValidationException::withMessages(['purchase_orders' => ['Choose lines to turn into purchase orders or an RFQ.']]);
        }

        return DB::transaction(function () use ($actor, $requisition, $data, $poLines, $rfqLines) {
            $locked = PurchaseRequisition::query()->whereKey($requisition->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== RequisitionStatus::Approved) {
                throw new BusinessRuleViolation('REQUISITION_NOT_APPROVED', "Requisition {$locked->number} is {$locked->status->value}; only approved requisitions can be converted.", ['status' => $locked->status->value]);
            }
            $lines = PurchaseRequisitionLine::query()->where('purchase_requisition_id', $locked->id)->lockForUpdate()->get()->keyBy('id');
            $variants = $this->products->variants($locked->organization_id, $lines->pluck('variant_id')->all());

            // Quantities (default: what is still open), checked against the open quantity across both targets.
            $errors = [];
            $used = [];
            $resolve = function (array $entries, string $prefix) use ($lines, $variants, &$errors, &$used) {
                $out = [];
                $seen = [];
                foreach ($entries as $i => $entry) {
                    $line = $lines->get($entry['requisition_line_id']);
                    if ($line === null) {
                        $errors["{$prefix}.{$i}.requisition_line_id"] = ['This line is not part of the requisition.'];

                        continue;
                    }
                    if (isset($seen[$line->id])) {
                        $errors["{$prefix}.{$i}.requisition_line_id"] = ['Each line may appear only once.'];

                        continue;
                    }
                    $seen[$line->id] = true;
                    $open = Decimal::sub($line->remainingQuantity(), $used[$line->id] ?? '0', 3);
                    $quantity = filled($entry['quantity'] ?? null) ? Decimal::round((string) $entry['quantity'], 3) : $open;
                    $variant = $variants[$line->variant_id] ?? null;
                    if (Decimal::compare($quantity, '0') <= 0) {
                        $errors["{$prefix}.{$i}.quantity"] = [Decimal::compare($open, '0') <= 0 ? 'This line is already fully converted.' : 'Enter a quantity greater than zero.'];
                    } elseif (Decimal::compare($quantity, $open) > 0) {
                        $errors["{$prefix}.{$i}.quantity"] = ["Only {$open} still open on this line."];
                    } elseif ($variant !== null && ! $variant['allow_decimal'] && ! Decimal::isWhole($quantity)) {
                        $errors["{$prefix}.{$i}.quantity"] = ["{$variant['product_name']} is bought in whole units ({$variant['unit_code']})."];
                    }
                    $used[$line->id] = Decimal::add($used[$line->id] ?? '0', $quantity, 3);
                    $out[] = ['line' => $line, 'quantity' => $quantity, 'index' => $i, 'supplier_id' => $entry['supplier_id'] ?? null];
                }

                return $out;
            };
            $poResolved = $resolve($poLines, 'purchase_orders.lines');
            $rfqResolved = $resolve($rfqLines, 'rfq.lines');

            // Suppliers for the purchase order lines.
            $preferred = $this->suggestions->preferredCatalog($locked->organization_id, array_values(array_unique(array_map(fn (array $r) => $r['line']->variant_id, $poResolved))));
            foreach ($poResolved as $k => $r) {
                $supplierId = $r['supplier_id'] ?? $r['line']->suggested_supplier_id ?? ($preferred[$r['line']->variant_id]['supplier_id'] ?? null);
                if ($supplierId === null) {
                    $name = $variants[$r['line']->variant_id]['product_name'] ?? 'this line';
                    $errors["purchase_orders.lines.{$r['index']}.supplier_id"] = ["Choose a supplier for {$name}."];
                }
                $poResolved[$k]['supplier_id'] = $supplierId;
            }
            $contacts = $this->suppliers->contacts($locked->organization_id, array_values(array_unique(array_filter(array_column($poResolved, 'supplier_id')))));
            foreach ($poResolved as $r) {
                if ($r['supplier_id'] === null) {
                    continue;
                }
                $supplier = $contacts[$r['supplier_id']] ?? null;
                if ($supplier === null || $supplier['archived']) {
                    $errors["purchase_orders.lines.{$r['index']}.supplier_id"] = ['The selected supplier does not exist.'];
                } elseif (! $supplier['is_active']) {
                    $errors["purchase_orders.lines.{$r['index']}.supplier_id"] = ["{$supplier['name']} is inactive."];
                }
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            $orders = $this->createOrders($actor, $locked, $poResolved);
            $rfq = null;
            if ($rfqResolved !== []) {
                $rfq = $this->rfqs->createForRequisition($locked, array_map(fn (array $r) => [
                    'variant_id' => $r['line']->variant_id,
                    'quantity' => $r['quantity'],
                    'requisition_line_id' => $r['line']->id,
                    'notes' => $r['line']->notes,
                ], $rfqResolved), $data['rfq'] ?? []);
            }

            foreach ([...$poResolved, ...$rfqResolved] as $r) {
                /** @var PurchaseRequisitionLine $line */
                $line = $r['line'];
                $line->forceFill(['converted_quantity' => Decimal::add($line->converted_quantity, $r['quantity'], 3)])->save();
            }
            $targets = array_merge(array_map(fn (PurchaseOrder $o) => $o->number, $orders), $rfq === null ? [] : [$rfq->number]);
            $this->quantities->refresh($locked, 'Converted to '.implode(', ', $targets).'.');
            $this->audit->record('purchase_requisition.converted', $locked, new: [
                'purchase_orders' => array_map(fn (PurchaseOrder $o) => $o->number, $orders),
                'rfq' => $rfq?->number,
                'status' => $locked->status->value,
            ]);

            return ['requisition' => $locked, 'orders' => $orders, 'rfq' => $rfq];
        });
    }

    /**
     * @param  list<array{line: PurchaseRequisitionLine, quantity: string, supplier_id: ?string}>  $resolved
     * @return list<PurchaseOrder>
     */
    private function createOrders(TenantUser $actor, PurchaseRequisition $requisition, array $resolved): array
    {
        if ($resolved === []) {
            return [];
        }
        $groups = [];
        foreach ($resolved as $r) {
            $groups[$r['supplier_id']][] = $r;
        }
        $catalog = SupplierProduct::query()
            ->whereIn('supplier_id', array_keys($groups))
            ->whereIn('variant_id', array_map(fn (array $r) => $r['line']->variant_id, $resolved))
            ->where('is_active', true)
            ->get()
            ->keyBy(fn (SupplierProduct $p) => $p->supplier_id.'|'.$p->variant_id);
        $today = CarbonImmutable::parse($this->dates->today());

        $orders = [];
        foreach ($groups as $supplierId => $group) {
            $lead = max(array_map(fn (array $r) => $catalog->get($supplierId.'|'.$r['line']->variant_id)?->lead_time_days ?? SupplierProduct::DEFAULT_LEAD_TIME_DAYS, $group));
            $neededBy = $requisition->needed_by?->toDateString();
            $order = ($this->save)($actor, null, [
                'supplier_id' => $supplierId,
                'store_id' => $requisition->store_id,
                'order_date' => $today->toDateString(),
                'expected_date' => $neededBy !== null && $neededBy >= $today->toDateString() ? $neededBy : $today->addDays($lead)->toDateString(),
                'notes' => "From requisition {$requisition->number}.",
                'lines' => array_map(fn (array $r) => [
                    'variant_id' => $r['line']->variant_id,
                    'quantity' => $r['quantity'],
                    'unit_cost' => $catalog->get($supplierId.'|'.$r['line']->variant_id)?->unit_cost ?? $r['line']->estimated_unit_cost,
                    'requisition_line_id' => $r['line']->id,
                ], $group),
            ]);

            $approved = '0.00';
            foreach ($group as $r) {
                $approved = Decimal::add($approved, ApprovalPolicy::share($r['line']->line_total, $r['quantity'], $r['line']->quantity), 2);
            }
            $order->forceFill(['requisition_id' => $requisition->id, 'approved_amount' => $approved])->save();
            $orders[] = $order;
        }

        return $orders;
    }
}
