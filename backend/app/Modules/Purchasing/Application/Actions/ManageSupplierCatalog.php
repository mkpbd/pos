<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The supplier catalog (SC1): one row per supplier and variant with cost, pack size, minimum
 * order and lead time; at most one active, preferred row per variant — choosing a new
 * preferred supplier unsets the previous one in the same transaction (the partial unique
 * index catches races). Last purchase cost is written by goods receipts only.
 */
class ManageSupplierCatalog
{
    private const FIELDS = ['supplier_sku', 'unit_cost', 'pack_size', 'min_order_qty', 'lead_time_days', 'is_preferred', 'is_active'];

    public function __construct(
        private readonly PurchasingContext $context,
        private readonly ProductDirectory $products,
        private readonly SupplierDirectory $suppliers,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{supplier_id: string, variant_id: string, supplier_sku?: ?string, unit_cost: string, pack_size?: ?string, min_order_qty?: ?string, lead_time_days?: ?int, is_preferred?: ?bool, is_active?: ?bool}  $data
     */
    public function create(array $data): SupplierProduct
    {
        $organizationId = $this->context->organizationId();
        $this->context->requireActiveSupplier($data['supplier_id']);
        $variant = $this->products->variants($organizationId, [$data['variant_id']])[$data['variant_id']] ?? null;
        if ($variant === null) {
            throw ValidationException::withMessages(['variant_id' => ['This product does not exist.']]);
        }
        if (! $variant['sellable']) {
            throw ValidationException::withMessages(['variant_id' => ["{$variant['product_name']} is archived or inactive."]]);
        }
        if (SupplierProduct::query()->where('supplier_id', $data['supplier_id'])->where('variant_id', $data['variant_id'])->exists()) {
            throw ValidationException::withMessages(['variant_id' => ['This product is already in the supplier\'s catalog.']]);
        }

        $row = new SupplierProduct([
            'organization_id' => $organizationId,
            'supplier_id' => $data['supplier_id'],
            'variant_id' => $data['variant_id'],
        ]);

        return $this->persist($row, $data, $variant, 'supplier_product.created');
    }

    /**
     * @param  array{supplier_sku?: ?string, unit_cost?: string, pack_size?: ?string, min_order_qty?: ?string, lead_time_days?: ?int, is_preferred?: ?bool, is_active?: ?bool}  $data
     */
    public function update(SupplierProduct $row, array $data): SupplierProduct
    {
        $variant = $this->products->variants($this->context->organizationId(), [$row->variant_id])[$row->variant_id] ?? null;

        return $this->persist($row, $data, $variant, 'supplier_product.updated');
    }

    public function prefer(SupplierProduct $row): SupplierProduct
    {
        if (! $row->is_active) {
            throw new BusinessRuleViolation('SUPPLIER_PRODUCT_INACTIVE', 'Activate this catalog entry before making it the preferred supplier.');
        }
        $supplier = $this->suppliers->find($row->supplier_id, $this->context->organizationId());
        if ($supplier === null || $supplier['archived'] || ! $supplier['is_active']) {
            throw new BusinessRuleViolation('SUPPLIER_INACTIVE', 'This supplier is inactive or archived and cannot be preferred.');
        }

        return DB::transaction(function () use ($row) {
            $this->clearPreferred($row);
            $row->forceFill(['is_preferred' => true])->save();
            $this->audit->record('supplier_product.preferred', $row, new: ['supplier_id' => $row->supplier_id, 'variant_id' => $row->variant_id]);

            return $row;
        });
    }

    public function delete(SupplierProduct $row): void
    {
        DB::transaction(function () use ($row) {
            $row->delete();
            $this->audit->record('supplier_product.deleted', $row, old: [
                'supplier_id' => $row->supplier_id, 'variant_id' => $row->variant_id, 'unit_cost' => $row->unit_cost, 'is_preferred' => $row->is_preferred,
            ]);
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>|null  $variant
     */
    private function persist(SupplierProduct $row, array $data, ?array $variant, string $action): SupplierProduct
    {
        $values = array_intersect_key($data, array_flip(self::FIELDS));
        foreach (['is_preferred', 'is_active'] as $flag) {
            if (array_key_exists($flag, $values)) {
                $values[$flag] = filter_var($values[$flag], FILTER_VALIDATE_BOOLEAN);
            }
        }
        foreach (['unit_cost' => 4, 'pack_size' => 3, 'min_order_qty' => 3] as $field => $scale) {
            if (isset($values[$field])) {
                $values[$field] = Decimal::round((string) $values[$field], $scale);
            }
        }
        if (array_key_exists('pack_size', $values) && $values['pack_size'] === null) {
            $values['pack_size'] = '1.000';
        }
        if (array_key_exists('lead_time_days', $values) && $values['lead_time_days'] === null) {
            $values['lead_time_days'] = SupplierProduct::DEFAULT_LEAD_TIME_DAYS;
        }
        if (array_key_exists('supplier_sku', $values)) {
            $values['supplier_sku'] = filled($values['supplier_sku']) ? trim((string) $values['supplier_sku']) : null;
        }

        $active = (bool) ($values['is_active'] ?? $row->is_active ?? true);
        if (($values['is_preferred'] ?? false) === true && ! $active) {
            throw ValidationException::withMessages(['is_preferred' => ['An inactive catalog entry cannot be the preferred supplier.']]);
        }
        if (! $active) {
            $values['is_preferred'] = false;
        }
        if (($values['is_preferred'] ?? false) === true) {
            $supplier = $this->suppliers->find($row->supplier_id, $this->context->organizationId());
            if ($supplier === null || $supplier['archived'] || ! $supplier['is_active']) {
                throw ValidationException::withMessages(['is_preferred' => ['An inactive or archived supplier cannot be preferred.']]);
            }
        }

        $errors = [];
        if ($variant !== null && ! $variant['allow_decimal']) {
            foreach (['pack_size', 'min_order_qty'] as $field) {
                $value = $values[$field] ?? ($row->exists ? $row->{$field} : null);
                if ($value !== null && ! Decimal::isWhole((string) $value)) {
                    $errors[$field] = ["{$variant['product_name']} is bought in whole units ({$variant['unit_code']})."];
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($row, $values, $action) {
            $creating = ! $row->exists;
            $before = $creating ? [] : $row->only(self::FIELDS);
            if (($values['is_preferred'] ?? false) === true) {
                $this->clearPreferred($row);
            }
            $row->fill($values)->save();
            $this->audit->record($action, $row, old: $before, new: $row->only(self::FIELDS) + ['supplier_id' => $row->supplier_id, 'variant_id' => $row->variant_id]);

            return $row;
        });
    }

    /** Unsets the variant's other preferred row (rows of the variant locked first). */
    private function clearPreferred(SupplierProduct $row): void
    {
        $others = SupplierProduct::query()->where('variant_id', $row->variant_id)->lockForUpdate()->get();
        foreach ($others as $other) {
            if ($other->is_preferred && $other->id !== $row->id) {
                $other->forceFill(['is_preferred' => false])->save();
            }
        }
    }
}
