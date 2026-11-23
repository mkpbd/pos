<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Q1: the receipt carries the seller's BIN (organization tax number) and is a tax invoice
 * only when one is set.
 */
class ReceiptTaxNumberTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_the_receipt_is_a_tax_invoice_only_with_the_sellers_bin(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Alpha');
        ['organization' => $other] = $this->provisionTenant('Beta');
        $other->forceFill(['tax_number' => '999999999-0202'])->save();
        $juice = $this->sellable($org, 'Mango Juice', '15.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10');

        $org->forceFill(['tax_number' => '   '])->save();
        $first = $this->checkout($this->cart($store, [[$juice, '1']], [['cash', '15']]))->assertCreated()
            ->assertJsonPath('data.receipt.tax_number', null)
            ->assertJsonPath('data.receipt.is_tax_invoice', false)
            ->json('data.id');

        // Set later: the reprint shows it (and never another organization's).
        $org->forceFill(['tax_number' => ' 000123456-0101 '])->save();
        $this->getJson("/api/v1/sales/{$first}")->assertOk()
            ->assertJsonPath('data.receipt.tax_number', '000123456-0101')
            ->assertJsonPath('data.receipt.is_tax_invoice', true);
        $this->checkout($this->cart($store, [[$juice, '1']], [['cash', '15']]))->assertCreated()
            ->assertJsonPath('data.receipt.tax_number', '000123456-0101')
            ->assertJsonPath('data.receipt.is_tax_invoice', true);
    }
}
