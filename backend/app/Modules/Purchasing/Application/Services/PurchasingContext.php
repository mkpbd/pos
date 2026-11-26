<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Validation\ValidationException;

/**
 * Lookups every purchasing document needs: the organization's currency and a usable supplier,
 * and (ST2a) the line discount % and bonus quantity of order and receipt lines.
 */
class PurchasingContext
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly SupplierDirectory $suppliers,
    ) {}

    public function organizationId(): string
    {
        return $this->tenant->requireOrganization();
    }

    public function currency(): string
    {
        return $this->organizations->summary($this->organizationId())['base_currency'] ?? config('pos.default_currency');
    }

    /**
     * @return array{id: string, code: string, name: string, is_active: bool, archived: bool, opening_balance: string, payment_terms_days: int}
     */
    public function requireActiveSupplier(string $supplierId, string $field = 'supplier_id'): array
    {
        $supplier = $this->suppliers->find($supplierId, $this->organizationId());

        if ($supplier === null || $supplier['archived']) {
            throw ValidationException::withMessages([$field => ['The selected supplier does not exist.']]);
        }
        if (! $supplier['is_active']) {
            throw ValidationException::withMessages([$field => ['The selected supplier is inactive.']]);
        }

        return $supplier;
    }

    /**
     * ST2a: normalizes each line's `discount_percent` (4 dp) and `bonus_quantity` (3 dp), with
     * `$defaults[$i]` (the purchase order line's values) or 0 when a line leaves them out. Free
     * units come in whole units unless the product allows decimals.
     *
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, array<string, mixed>>  $variants  StockLineRules::validate() result
     * @param  array<int, array{discount_percent: string, bonus_quantity: string}>  $defaults
     * @return list<array<string, mixed>>
     */
    public function discountAndBonus(array $lines, array $variants, array $defaults = []): array
    {
        $errors = [];
        foreach ($lines as $i => $line) {
            $lines[$i]['discount_percent'] = Decimal::round((string) ($line['discount_percent'] ?? $defaults[$i]['discount_percent'] ?? '0'), 4);
            $lines[$i]['bonus_quantity'] = Decimal::round((string) ($line['bonus_quantity'] ?? $defaults[$i]['bonus_quantity'] ?? '0'), 3);
            $variant = $variants[$line['variant_id']] ?? null;
            if ($variant !== null && ! $variant['allow_decimal'] && ! Decimal::isWhole($lines[$i]['bonus_quantity'])) {
                $errors["lines.{$i}.bonus_quantity"] = ["{$variant['product_name']} is sold in whole units ({$variant['unit_code']})."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $lines;
    }
}
