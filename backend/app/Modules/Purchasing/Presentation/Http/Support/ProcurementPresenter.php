<?php

namespace App\Modules\Purchasing\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Actions\ChangePurchaseOrderStatus;
use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\Procurement\ApprovalPolicy;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderStatusChange;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionLine;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionStatusChange;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqAward;
use App\Modules\Purchasing\Infrastructure\Models\RfqLine;
use App\Modules\Purchasing\Infrastructure\Models\RfqStatusChange;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Purchasing\Infrastructure\Models\SupplierQuoteLine;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;

/**
 * Output shapes of requisitions, RFQs and the approval fields of purchase orders (SC2).
 */
class ProcurementPresenter
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly SupplierDirectory $suppliers,
        private readonly ProductDirectory $products,
        private readonly UserDirectory $users,
        private readonly ApprovalRules $rules,
        private readonly ChangePurchaseOrderStatus $orderStatus,
        private readonly PurchasingContext $context,
    ) {}

    // ------------------------------------------------------------------ requisitions

    /**
     * @param  Collection<int, PurchaseRequisition>  $requisitions
     * @return callable(PurchaseRequisition): array<string, mixed>
     */
    public function requisitionHeaders(Collection $requisitions): callable
    {
        $org = $this->tenant->requireOrganization();
        $stores = $this->branches->storeSummaries($org, $requisitions->pluck('store_id')->unique()->values()->all());
        $names = $this->users->names($org, $requisitions->flatMap(fn (PurchaseRequisition $r) => [$r->requested_by, $r->approved_by, $r->rejected_by, $r->cancelled_by])->filter()->unique()->values()->all());

        return fn (PurchaseRequisition $r) => $this->requisitionHeader($r, $stores, $names);
    }

    /**
     * @return array<string, mixed>
     */
    public function requisition(PurchaseRequisition $requisition, TenantUser $user): array
    {
        $org = $this->tenant->requireOrganization();
        $lines = $requisition->lines()->get();
        $variants = $this->products->variants($org, $lines->pluck('variant_id')->all());
        $suppliers = $this->suppliers->summaries($org, $lines->pluck('suggested_supplier_id')->filter()->unique()->values()->all());
        $history = $requisition->history()->get();
        $orders = PurchaseOrder::query()->where('requisition_id', $requisition->id)->orderBy('number')->get();
        $rfqs = Rfq::query()->where('requisition_id', $requisition->id)->orderBy('number')->get();

        $header = ($this->requisitionHeaders(collect([$requisition])))($requisition);
        $header['line_count'] = $lines->count();

        return $header + [
            'lines' => $lines->map(fn (PurchaseRequisitionLine $l) => [
                'id' => $l->id,
                'variant' => $this->variant($variants[$l->variant_id] ?? null),
                'quantity' => $l->quantity,
                'estimated_unit_cost' => $l->estimated_unit_cost,
                'tax_rate' => $l->tax_rate,
                'estimated_total' => $l->line_total,
                'suggested_supplier' => $l->suggested_supplier_id === null ? null : ($suppliers[$l->suggested_supplier_id] ?? null),
                'notes' => $l->notes,
                'converted_quantity' => $l->converted_quantity,
                'remaining_quantity' => $l->remainingQuantity(),
            ])->values()->all(),
            'purchase_orders' => $this->orderRefs($orders->all()),
            'rfqs' => $rfqs->map(fn (Rfq $r) => ['id' => $r->id, 'number' => $r->number, 'status' => $r->status->value])->values()->all(),
            'history' => $this->history($history),
        ] + $this->requisitionAbilities($requisition, $user, $lines);
    }

    /**
     * @param  array<string, array<string, mixed>>  $stores
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private function requisitionHeader(PurchaseRequisition $r, array $stores, array $names): array
    {
        $store = $stores[$r->store_id] ?? null;
        $user = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];

        return [
            'id' => $r->id,
            'number' => $r->number,
            'status' => $r->status->value,
            'branch' => $store === null ? ['id' => $r->branch_id, 'name' => null] : ['id' => $store['branch_id'], 'name' => $store['branch_name']],
            'store' => $store,
            'requested_by' => $user($r->requested_by),
            'needed_by' => $r->needed_by?->toDateString(),
            'notes' => $r->notes,
            'currency' => $r->currency,
            'estimated_subtotal' => $r->estimated_subtotal,
            'estimated_tax' => $r->estimated_tax,
            'estimated_total' => $r->estimated_total,
            'approval_level' => $r->approval_level?->value,
            'approver_permission' => $r->approval_level?->requiredPermission(),
            'submitted_at' => $r->submitted_at?->toIso8601String(),
            'approved_by' => $user($r->approved_by),
            'approved_at' => $r->approved_at?->toIso8601String(),
            'auto_approved' => $r->approved_at !== null && $r->approved_by === null,
            'rejected_by' => $user($r->rejected_by),
            'rejected_at' => $r->rejected_at?->toIso8601String(),
            'rejection_reason' => $r->rejection_reason,
            'cancelled_by' => $user($r->cancelled_by),
            'cancelled_at' => $r->cancelled_at?->toIso8601String(),
            'cancellation_reason' => $r->cancellation_reason,
            'converted_at' => $r->converted_at?->toIso8601String(),
            'line_count' => (int) ($r->getAttributes()['lines_count'] ?? 0),
            'created_at' => $r->created_at?->toIso8601String(),
            'updated_at' => $r->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  Collection<int, PurchaseRequisitionLine>  $lines
     * @return array<string, bool>
     */
    private function requisitionAbilities(PurchaseRequisition $r, TenantUser $user, Collection $lines): array
    {
        $me = (string) $user->getAuthIdentifier();
        $owner = $r->requested_by === $me;
        $manage = $this->rules->has($user, 'purchases.manage');
        $draft = $r->status === RequisitionStatus::Draft;
        $untouched = $lines->every(fn (PurchaseRequisitionLine $l) => Decimal::isZero($l->converted_quantity));
        $canApprove = $r->status === RequisitionStatus::Submitted && $this->rules->canApprove($user, $r->approval_level, $r->branch_id, [$r->requested_by]);

        return [
            'can_edit' => $draft && ($owner || $manage),
            'can_submit' => $draft && ($owner || $manage),
            'can_approve' => $canApprove,
            'can_reject' => $canApprove,
            'can_cancel' => (in_array($r->status, [RequisitionStatus::Draft, RequisitionStatus::Submitted], true) && ($owner || $manage))
                || ($r->status === RequisitionStatus::Approved && $manage && $untouched),
            'can_convert' => $r->status === RequisitionStatus::Approved && $manage,
        ];
    }

    // ------------------------------------------------------------------ RFQs

    /**
     * @param  Collection<int, Rfq>  $rfqs
     * @return callable(Rfq): array<string, mixed>
     */
    public function rfqHeaders(Collection $rfqs): callable
    {
        $org = $this->tenant->requireOrganization();
        $stores = $this->branches->storeSummaries($org, $rfqs->pluck('store_id')->unique()->values()->all());
        $names = $this->users->names($org, $rfqs->pluck('created_by')->filter()->unique()->values()->all());
        $requisitions = PurchaseRequisition::query()->whereKey($rfqs->pluck('requisition_id')->filter()->unique()->values()->all())->pluck('number', 'id');
        $currency = $this->currency();

        return function (Rfq $r) use ($stores, $names, $requisitions, $currency) {
            $store = $stores[$r->store_id] ?? null;

            return [
                'id' => $r->id,
                'number' => $r->number,
                'status' => $r->status->value,
                'title' => $r->title,
                'branch' => $store === null ? ['id' => $r->branch_id, 'name' => null] : ['id' => $store['branch_id'], 'name' => $store['branch_name']],
                'store' => $store,
                'requisition' => $r->requisition_id === null ? null : ['id' => $r->requisition_id, 'number' => $requisitions[$r->requisition_id] ?? null],
                'currency' => $currency,
                'needed_by' => $r->needed_by?->toDateString(),
                'reply_by' => $r->reply_by?->toDateString(),
                'notes' => $r->notes,
                'sent_at' => $r->sent_at?->toIso8601String(),
                'closed_at' => $r->closed_at?->toIso8601String(),
                'awarded_at' => $r->awarded_at?->toIso8601String(),
                'cancelled_at' => $r->cancelled_at?->toIso8601String(),
                'created_by' => $r->created_by === null ? null : ['id' => $r->created_by, 'name' => $names[$r->created_by] ?? null],
                'created_at' => $r->created_at?->toIso8601String(),
                'line_count' => (int) ($r->getAttributes()['lines_count'] ?? 0),
                'supplier_count' => (int) ($r->getAttributes()['suppliers_count'] ?? 0),
                'quote_count' => (int) ($r->getAttributes()['quotes_count'] ?? 0),
            ];
        };
    }

    /**
     * @return array<string, mixed>
     */
    public function rfq(Rfq $rfq, TenantUser $user): array
    {
        $org = $this->tenant->requireOrganization();
        $lines = $rfq->lines()->get();
        $invited = $rfq->suppliers()->with('quote.lines')->get();
        $awards = $rfq->awards()->get();
        $variants = $this->products->variants($org, $lines->pluck('variant_id')->all());
        $contacts = $this->suppliers->contacts($org, $invited->pluck('supplier_id')->all());
        $orders = PurchaseOrder::query()->where('rfq_id', $rfq->id)->orderBy('number')->get();

        $header = ($this->rfqHeaders(collect([$rfq])))($rfq);
        $header['line_count'] = $lines->count();
        $header['supplier_count'] = $invited->count();
        $header['quote_count'] = $invited->filter(fn (RfqSupplier $s) => $s->quote !== null)->count();
        $manage = $this->rules->has($user, 'purchases.manage');
        $sent = $rfq->status === RfqStatus::Sent;

        return $header + [
            'lines' => $lines->map(fn (RfqLine $l) => $this->rfqLine($l, $variants))->values()->all(),
            'suppliers' => $invited->map(function (RfqSupplier $s) use ($contacts) {
                $contact = $contacts[$s->supplier_id] ?? null;
                $quote = $s->quote;

                return [
                    'id' => $s->id,
                    'supplier' => $contact === null ? null : ['id' => $contact['id'], 'code' => $contact['code'], 'name' => $contact['name'], 'email' => $contact['email']],
                    'has_email' => $contact !== null && $contact['email'] !== null,
                    'invited_at' => $s->invited_at->toIso8601String(),
                    'sent_at' => $s->sent_at?->toIso8601String(),
                    'emailed_at' => $s->emailed_at?->toIso8601String(),
                    'emailed_to' => $s->email,
                    'send_manually' => $s->sent_at !== null && $s->emailed_at === null,
                    'quote' => $quote === null ? null : [
                        'id' => $quote->id,
                        'status' => $quote->status->value,
                        'received_at' => $quote->received_at->toIso8601String(),
                        'valid_until' => $quote->valid_until?->toDateString(),
                        'notes' => $quote->notes,
                        'lines' => $quote->lines->map(fn (SupplierQuoteLine $q) => [
                            'id' => $q->id,
                            'rfq_line_id' => $q->rfq_line_id,
                            'unit_price' => $q->unit_price,
                            'quantity_offered' => $q->quantity_offered,
                            'lead_time_days' => $q->lead_time_days,
                            'notes' => $q->notes,
                        ])->values()->all(),
                    ],
                ];
            })->values()->all(),
            'awards' => $awards->map(fn (RfqAward $a) => [
                'rfq_line_id' => $a->rfq_line_id,
                'supplier_id' => $a->supplier_id,
                'quantity' => $a->quantity,
                'unit_price' => $a->unit_price,
                'purchase_order_id' => $a->purchase_order_id,
            ])->values()->all(),
            'purchase_orders' => $this->orderRefs($orders->all()),
            'history' => $this->history($rfq->history()->get()),
            'can_edit' => $manage && $rfq->status === RfqStatus::Draft,
            'can_send' => $manage && $rfq->status === RfqStatus::Draft,
            'can_invite' => $manage && in_array($rfq->status, [RfqStatus::Draft, RfqStatus::Sent], true),
            'can_record_quotes' => $manage && $sent,
            'can_award' => $manage && $sent,
            'can_close' => $manage && $sent,
            'can_cancel' => $manage && in_array($rfq->status, [RfqStatus::Draft, RfqStatus::Sent], true),
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $variants
     * @return array<string, mixed>
     */
    public function rfqLine(RfqLine $l, array $variants): array
    {
        return [
            'id' => $l->id,
            'variant' => $this->variant($variants[$l->variant_id] ?? null),
            'quantity' => $l->quantity,
            'requisition_line_id' => $l->requisition_line_id,
            'notes' => $l->notes,
        ];
    }

    // ------------------------------------------------------------------ purchase orders

    /**
     * Summary of created / linked purchase orders.
     *
     * @param  list<PurchaseOrder>  $orders
     * @return list<array<string, mixed>>
     */
    public function orderRefs(array $orders): array
    {
        $suppliers = $this->suppliers->summaries($this->tenant->requireOrganization(), array_map(fn (PurchaseOrder $o) => $o->supplier_id, $orders));

        return array_map(fn (PurchaseOrder $o) => [
            'id' => $o->id,
            'number' => $o->number,
            'status' => $o->status->value,
            'supplier' => $suppliers[$o->supplier_id] ?? null,
            'currency' => $o->currency,
            'total' => $o->total,
            'line_count' => $o->lines()->count(),
            'expected_date' => $o->expected_date?->toDateString(),
            'pre_approved' => $o->approved_amount !== null,
            'approved_amount' => $o->approved_amount,
        ], $orders);
    }

    /**
     * Approval fields added to the purchase order document (SC2).
     *
     * @return array<string, mixed>
     */
    public function orderApproval(PurchaseOrder $order, TenantUser $user): array
    {
        $org = $this->tenant->requireOrganization();
        $names = $this->users->names($org, array_values(array_filter([$order->submitted_by, $order->approved_by, $order->rejected_by])));
        $person = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];
        $requisition = $order->requisition_id === null ? null : PurchaseRequisition::query()->find($order->requisition_id);
        $rfq = $order->rfq_id === null ? null : Rfq::query()->find($order->rfq_id);
        $needed = $order->status === PurchaseOrderStatus::Draft ? $this->orderStatus->approvalNeeded($order)[0] : null;

        return [
            'requisition' => $requisition === null ? null : ['id' => $requisition->id, 'number' => $requisition->number, 'status' => $requisition->status->value],
            'rfq' => $rfq === null ? null : ['id' => $rfq->id, 'number' => $rfq->number, 'status' => $rfq->status->value],
            'approval_level' => $order->approval_level?->value,
            'approver_permission' => $order->approval_level?->requiredPermission(),
            'pre_approved_amount' => $order->approved_amount,
            'pre_approval_limit' => $order->approved_amount === null ? null : ApprovalPolicy::preApprovalCeiling($order->approved_amount),
            // For drafts: what submit would do (`approval` = level needed, null = it would be ordered).
            'submit_requires_approval' => $needed !== null,
            'submit_approval_level' => $needed?->value,
            'submitted_by' => $person($order->submitted_by),
            'submitted_at' => $order->submitted_at?->toIso8601String(),
            'approved_by' => $person($order->approved_by),
            'approved_at' => $order->approved_at?->toIso8601String(),
            'rejected_by' => $person($order->rejected_by),
            'rejected_at' => $order->rejected_at?->toIso8601String(),
            'rejection_reason' => $order->rejection_reason,
            'history' => $this->history($order->history()->get()),
            'can_approve' => $order->status === PurchaseOrderStatus::PendingApproval
                && $this->rules->canApprove($user, $order->approval_level, $order->branch_id, [$order->created_by, $order->submitted_by]),
        ];
    }

    // ------------------------------------------------------------------ shared

    /**
     * @param  Collection<int, PurchaseRequisitionStatusChange|PurchaseOrderStatusChange|RfqStatusChange>  $history
     * @return list<array<string, mixed>>
     */
    public function history(Collection $history): array
    {
        $names = $this->users->names($this->tenant->requireOrganization(), $history->pluck('actor_user_id')->filter()->unique()->values()->all());

        return $history->map(fn ($h) => [
            'id' => $h->id,
            'from_status' => $h->from_status,
            'to_status' => $h->to_status,
            'note' => $h->note,
            'user' => $h->actor_user_id === null ? null : ['id' => $h->actor_user_id, 'name' => $names[$h->actor_user_id] ?? null],
            'at' => $h->created_at->toIso8601String(),
        ])->values()->all();
    }

    /**
     * @param  array<string, mixed>|null  $variant
     * @return array<string, mixed>|null
     */
    public function variant(?array $variant): ?array
    {
        return $variant === null ? null : [
            'id' => $variant['variant_id'],
            'product_name' => $variant['product_name'],
            'variant_name' => $variant['variant_name'],
            'sku' => $variant['sku'],
            'unit_code' => $variant['unit_code'],
            'allow_decimal' => $variant['allow_decimal'],
        ];
    }

    private function currency(): string
    {
        return $this->context->currency();
    }
}
