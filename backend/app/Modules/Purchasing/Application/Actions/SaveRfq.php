<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Inventory\Application\Services\StockLineRules;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Application\Services\ProcurementHistory;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Requests for quotation (SC2): created blank or from requisition lines (ConvertRequisition),
 * edited while draft, suppliers invited (active, not archived) while draft or sent — a
 * supplier invited after sending gets the request at once (SendRfq::issue).
 */
class SaveRfq
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly StoreAccess $storeAccess,
        private readonly StockLineRules $lineRules,
        private readonly SequenceGenerator $sequences,
        private readonly SupplierDirectory $suppliers,
        private readonly OrganizationDate $dates,
        private readonly ProcurementHistory $history,
        private readonly AuditTrail $audit,
        private readonly SendRfq $sender,
    ) {}

    /**
     * @param  array{store_id: string, title: string, needed_by?: ?string, reply_by?: ?string, notes?: ?string, supplier_ids?: ?list<string>, lines: list<array{variant_id: string, quantity: string, notes?: ?string}>}  $data
     */
    public function create(TenantUser $actor, array $data): Rfq
    {
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $lines = $this->validateLines(array_values($data['lines']));
        $this->validateDates($data);
        $supplierIds = $this->validateSuppliers($data['supplier_ids'] ?? []);

        return DB::transaction(function () use ($store, $data, $lines, $supplierIds) {
            $rfq = $this->persistNew($store['id'], $store['branch_id'], null, $data, $lines);
            $this->addSuppliers($rfq, $supplierIds);
            $this->audit->record('rfq.created', $rfq, new: ['number' => $rfq->number, 'lines' => count($lines), 'suppliers' => count($supplierIds)]);

            return $rfq;
        });
    }

    /**
     * Inside ConvertRequisition's transaction: an RFQ for some lines of an approved requisition.
     *
     * @param  list<array{variant_id: string, quantity: string, requisition_line_id: string, notes?: ?string}>  $lines
     * @param  array{title?: ?string, reply_by?: ?string, notes?: ?string, supplier_ids?: ?list<string>}  $data
     */
    public function createForRequisition(PurchaseRequisition $requisition, array $lines, array $data): Rfq
    {
        $this->validateDates($data, 'rfq.');
        $supplierIds = $this->validateSuppliers($data['supplier_ids'] ?? [], 'rfq.supplier_ids');
        $header = [
            'title' => filled($data['title'] ?? null) ? trim((string) $data['title']) : "Requisition {$requisition->number}",
            'needed_by' => $requisition->needed_by?->toDateString(),
            'reply_by' => $data['reply_by'] ?? null,
            'notes' => $data['notes'] ?? $requisition->notes,
        ];
        $rfq = $this->persistNew($requisition->store_id, $requisition->branch_id, $requisition->id, $header, $lines);
        $this->addSuppliers($rfq, $supplierIds);
        $this->audit->record('rfq.created', $rfq, new: ['number' => $rfq->number, 'requisition' => $requisition->number, 'lines' => count($lines), 'suppliers' => count($supplierIds)]);

        return $rfq;
    }

    /**
     * Draft only. Lines of an RFQ raised from a requisition are fixed (they hold its quantities).
     *
     * @param  array{store_id?: ?string, title: string, needed_by?: ?string, reply_by?: ?string, notes?: ?string, supplier_ids?: ?list<string>, lines?: ?list<array{variant_id: string, quantity: string, notes?: ?string}>}  $data
     */
    public function update(TenantUser $actor, Rfq $rfq, array $data): Rfq
    {
        $this->expectDraft($rfq);
        $store = null;
        if (filled($data['store_id'] ?? null) && $data['store_id'] !== $rfq->store_id) {
            if ($rfq->requisition_id !== null) {
                throw ValidationException::withMessages(['store_id' => ['An RFQ raised from a requisition delivers to the requisition\'s store.']]);
            }
            $store = $this->storeAccess->require($actor, $data['store_id']);
        }
        $lines = null;
        if (array_key_exists('lines', $data) && $data['lines'] !== null) {
            if ($rfq->requisition_id !== null) {
                throw new BusinessRuleViolation('RFQ_LINES_LOCKED', 'The lines of an RFQ raised from a requisition cannot be changed; cancel it and convert the requisition again.');
            }
            $lines = $this->validateLines(array_values($data['lines']));
        }
        $this->validateDates($data);
        $supplierIds = array_key_exists('supplier_ids', $data) && $data['supplier_ids'] !== null ? $this->validateSuppliers($data['supplier_ids']) : null;

        return DB::transaction(function () use ($rfq, $store, $data, $lines, $supplierIds) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            $this->expectDraft($locked);
            $locked->fill([
                'title' => trim($data['title']),
                'needed_by' => $data['needed_by'] ?? null,
                'reply_by' => $data['reply_by'] ?? null,
                'notes' => filled($data['notes'] ?? null) ? trim((string) $data['notes']) : null,
            ] + ($store === null ? [] : ['store_id' => $store['id'], 'branch_id' => $store['branch_id']]))->save();

            if ($lines !== null) {
                $locked->lines()->delete();
                $this->createLines($locked, $lines);
            }
            if ($supplierIds !== null) {
                $locked->suppliers()->whereNotIn('supplier_id', $supplierIds)->delete();
                $this->addSuppliers($locked, $supplierIds);
            }
            $this->audit->record('rfq.updated', $locked, new: ['number' => $locked->number, 'title' => $locked->title]);

            return $locked;
        });
    }

    /**
     * @param  list<string>  $supplierIds
     */
    public function invite(Rfq $rfq, array $supplierIds): Rfq
    {
        $supplierIds = $this->validateSuppliers($supplierIds);

        return DB::transaction(function () use ($rfq, $supplierIds) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            if (! in_array($locked->status, [RfqStatus::Draft, RfqStatus::Sent], true)) {
                throw new BusinessRuleViolation('INVALID_STATUS_CHANGE', "RFQ {$locked->number} is {$locked->status->value}; suppliers can no longer be invited.");
            }
            $added = $this->addSuppliers($locked, $supplierIds);
            if ($locked->status === RfqStatus::Sent && $added !== []) {
                $this->sender->issue($locked, $locked->suppliers()->whereIn('supplier_id', $added)->get());
            }
            if ($added !== []) {
                $this->audit->record('rfq.suppliers_invited', $locked, new: ['supplier_ids' => $added]);
            }

            return $locked;
        });
    }

    public function removeSupplier(Rfq $rfq, string $supplierId): Rfq
    {
        return DB::transaction(function () use ($rfq, $supplierId) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            $this->expectDraft($locked);
            $deleted = $locked->suppliers()->where('supplier_id', $supplierId)->delete();
            if ($deleted === 0) {
                throw ValidationException::withMessages(['supplier_id' => ['This supplier is not invited.']]);
            }
            $this->audit->record('rfq.supplier_removed', $locked, old: ['supplier_id' => $supplierId]);

            return $locked;
        });
    }

    /**
     * @param  array<string, mixed>  $header
     * @param  list<array{variant_id: string, quantity: string, requisition_line_id?: ?string, notes?: ?string}>  $lines
     */
    private function persistNew(string $storeId, string $branchId, ?string $requisitionId, array $header, array $lines): Rfq
    {
        $organizationId = $this->context->organizationId();
        $rfq = Rfq::query()->create([
            'organization_id' => $organizationId,
            'number' => $this->sequences->next($organizationId, 'rfq', 'RFQ-'),
            'branch_id' => $branchId,
            'store_id' => $storeId,
            'status' => RfqStatus::Draft,
            'requisition_id' => $requisitionId,
            'title' => trim((string) $header['title']),
            'needed_by' => $header['needed_by'] ?? null,
            'reply_by' => $header['reply_by'] ?? null,
            'notes' => filled($header['notes'] ?? null) ? trim((string) $header['notes']) : null,
        ]);
        $this->createLines($rfq, $lines);
        $this->history->rfq($rfq, null, RfqStatus::Draft->value, $requisitionId === null ? null : 'Raised from a requisition.');

        return $rfq;
    }

    /**
     * @param  list<array{variant_id: string, quantity: string, requisition_line_id?: ?string, notes?: ?string}>  $lines
     */
    private function createLines(Rfq $rfq, array $lines): void
    {
        foreach ($lines as $i => $line) {
            $rfq->lines()->create([
                'organization_id' => $rfq->organization_id,
                'variant_id' => $line['variant_id'],
                'quantity' => Decimal::round((string) $line['quantity'], 3),
                'requisition_line_id' => $line['requisition_line_id'] ?? null,
                'notes' => filled($line['notes'] ?? null) ? trim((string) $line['notes']) : null,
                'sort_order' => $i,
            ]);
        }
    }

    /**
     * @param  list<string>  $supplierIds
     * @return list<string> the newly invited supplier ids
     */
    private function addSuppliers(Rfq $rfq, array $supplierIds): array
    {
        $existing = $rfq->suppliers()->pluck('supplier_id')->all();
        $added = [];
        foreach ($supplierIds as $supplierId) {
            if (in_array($supplierId, $existing, true)) {
                continue;
            }
            RfqSupplier::query()->create([
                'organization_id' => $rfq->organization_id,
                'rfq_id' => $rfq->id,
                'supplier_id' => $supplierId,
                'invited_at' => now(),
            ]);
            $added[] = $supplierId;
        }

        return $added;
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return list<array<string, mixed>>
     */
    private function validateLines(array $lines): array
    {
        $this->lineRules->validate($this->context->organizationId(), $lines, 'in', requireTracked: false, checkBatches: false, requireSellable: true);

        return $lines;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function validateDates(array $data, string $prefix = ''): void
    {
        $today = $this->dates->today();
        $errors = [];
        foreach (['needed_by' => 'needed-by', 'reply_by' => 'reply-by'] as $field => $label) {
            if (($data[$field] ?? null) !== null && $data[$field] < $today) {
                $errors[$prefix.$field] = ["The {$label} date cannot be in the past."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * @param  list<string>  $supplierIds
     * @return list<string>
     */
    private function validateSuppliers(array $supplierIds, string $field = 'supplier_ids'): array
    {
        $supplierIds = array_values(array_unique($supplierIds));
        $contacts = $this->suppliers->contacts($this->context->organizationId(), $supplierIds);
        $errors = [];
        foreach ($supplierIds as $i => $id) {
            $supplier = $contacts[$id] ?? null;
            if ($supplier === null || $supplier['archived']) {
                $errors["{$field}.{$i}"] = ['The selected supplier does not exist.'];
            } elseif (! $supplier['is_active']) {
                $errors["{$field}.{$i}"] = ["{$supplier['name']} is inactive."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $supplierIds;
    }

    private function expectDraft(Rfq $rfq): void
    {
        if ($rfq->status !== RfqStatus::Draft) {
            throw new BusinessRuleViolation('RFQ_LOCKED', "RFQ {$rfq->number} is {$rfq->status->value} and can no longer be edited.");
        }
    }
}
