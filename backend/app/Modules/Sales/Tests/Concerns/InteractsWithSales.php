<?php

namespace App\Modules\Sales\Tests\Concerns;

use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Customers\Infrastructure\Models\CustomerGroup;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Sellable products, customers and checkout requests for sales tests.
 */
trait InteractsWithSales
{
    use InteractsWithStock;

    /**
     * @param  array{tax?: string, cost?: string, batches?: bool, serials?: bool, max_discount?: string, service?: bool, barcodes?: list<string>}  $options
     */
    protected function sellable(Organization $organization, string $name, string $price, array $options = []): ProductVariant
    {
        $taxId = isset($options['tax'])
            ? app(TenantContext::class)->runAs($organization->id, fn () => TaxRate::query()->firstOrCreate(['name' => "VAT {$options['tax']}"], ['rate' => $options['tax'], 'is_active' => true])->id)
            : null;

        return $this->stockedVariant($organization, $name, array_filter([
            'tax_rate_id' => $taxId,
            'type' => ($options['service'] ?? false) ? 'service' : 'standard',
            'track_stock' => ! ($options['service'] ?? false),
            'track_batches' => $options['batches'] ?? false,
            'track_serials' => $options['serials'] ?? false,
            'max_discount_percent' => $options['max_discount'] ?? null,
            'variants' => [[
                'purchase_price' => $options['cost'] ?? '10.00',
                'selling_price' => $price,
                'reorder_level' => '0',
                'barcodes' => $options['barcodes'] ?? [],
            ]],
        ], fn ($value) => $value !== null));
    }

    protected function customer(Organization $organization, string $name, string $creditLimit = '0', ?string $groupDiscount = null, string $openingBalance = '0'): Customer
    {
        return app(TenantContext::class)->runAs($organization->id, function () use ($name, $creditLimit, $groupDiscount, $openingBalance) {
            $group = $groupDiscount === null ? null : CustomerGroup::query()->create(['name' => "Group {$groupDiscount}%", 'discount_percent' => $groupDiscount]);

            return Customer::query()->create([
                'code' => 'CUS-'.Str::upper(Str::random(6)),
                'name' => $name,
                'customer_group_id' => $group?->id,
                'credit_limit' => $creditLimit,
                'opening_balance' => $openingBalance,
                'is_active' => true,
            ]);
        });
    }

    protected function stockUp(string $storeId, ProductVariant $variant, string $quantity, string $cost = '10.00', ?string $batch = null, ?string $expiresOn = null): void
    {
        $this->adjust($storeId, 'opening', array_filter([
            'variant_id' => $variant->id,
            'quantity' => $quantity,
            'unit_cost' => $cost,
            'batch_number' => $batch,
            'expires_on' => $expiresOn,
        ], fn ($v) => $v !== null));
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    protected function checkout(array $payload, ?string $key = null): TestResponse
    {
        return $this->postJson('/api/v1/pos/checkout', $payload, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  list<array{0: ProductVariant, 1: string}|array{0: ProductVariant, 1: string, 2: array<string, mixed>}>  $lines
     * @param  list<array{0: string, 1: string}>  $payments
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    protected function cart(string $storeId, array $lines, array $payments = [], array $extra = []): array
    {
        return [
            'store_id' => $storeId,
            'lines' => array_map(fn (array $l) => ['variant_id' => $l[0]->id, 'quantity' => $l[1]] + ($l[2] ?? []), $lines),
            'payments' => array_map(fn (array $p) => ['method' => $p[0], 'amount' => $p[1]], $payments),
        ] + $extra;
    }
}
