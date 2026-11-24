<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Infrastructure\Models\ProductBarcode;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ST1: in-store EAN-13 numbers and label data.
 */
class BarcodeLabelsTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_generates_in_store_ean13_codes_for_variants_without_one(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other] = $this->provisionTenant('Other Shop');
        $plain = $this->stockedVariant($org, 'Juice');
        $coded = $this->stockedVariant($org, 'Tea', ['variants' => [['purchase_price' => '1', 'selling_price' => '2', 'barcodes' => ['4006381333931']]]]);
        $third = $this->stockedVariant($org, 'Rice');
        $foreign = $this->stockedVariant($other, 'Foreign');
        $this->actingAsUser($admin);
        // Someone typed the next in-store number by hand: it is skipped.
        $this->inTenant($org, fn () => $third->barcodes()->create(['organization_id' => $org->id, 'barcode' => '2000000000015']));

        $result = $this->postJson('/api/v1/products/barcodes/generate', ['variant_ids' => [$plain->id, $coded->id]])->assertOk()->json('data');
        $this->assertSame($plain->id, $result[0]['variant_id']);
        $this->assertTrue($result[0]['generated']);
        $this->assertSame('2000000000022', $result[0]['barcode']);
        $this->assertTrue(Barcode::isValid($result[0]['barcode']));
        $this->assertSame(['variant_id' => $coded->id, 'barcode' => '4006381333931', 'generated' => false], $result[1]);

        $again = $this->postJson('/api/v1/products/barcodes/generate', ['variant_ids' => [$coded->id], 'overwrite' => true])->assertOk()->json('data.0');
        $this->assertSame(['2000000000039', true], [$again['barcode'], $again['generated']]);
        $this->assertSame(['2000000000039'], ProductBarcode::query()->where('variant_id', $coded->id)->pluck('barcode')->all());
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.barcodes_generated', 'subject_id' => $coded->product_id]);
        $this->getJson('/api/v1/products/lookup?code=2000000000022')->assertOk()->assertJsonPath('data.variants.0.id', $plain->id);

        $this->postJson('/api/v1/products/barcodes/generate', ['variant_ids' => [$foreign->id]])->assertStatus(422);
        $this->postJson('/api/v1/products/barcodes/generate', ['variant_ids' => array_fill(0, 501, $plain->id)])->assertStatus(422);
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->postJson('/api/v1/products/barcodes/generate', ['variant_ids' => [$plain->id]])->assertForbidden();
    }

    public function test_label_data_for_variants_receipts_orders_and_categories(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $category = $this->postJson('/api/v1/categories', ['name' => 'Drinks'])->assertCreated()->json('data.id');
        $sub = $this->postJson('/api/v1/categories', ['name' => 'Juice', 'parent_id' => $category])->assertCreated()->json('data.id');
        $juice = $this->stockedVariant($org, 'Juice', ['category_id' => $sub, 'variants' => [['purchase_price' => '10', 'selling_price' => '25.50', 'barcodes' => ['4006381333931']]]]);
        $pills = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $rice = $this->stockedVariant($org, 'Rice', ['category_id' => $category], decimalUnit: true);

        $data = $this->getJson('/api/v1/products/labels?'.http_build_query(['variant_ids' => [$juice->id, $pills->id]]))->assertOk()->json('data');
        $this->assertSame('Acme Retail', $data['shop']['name']);
        $this->assertSame('BDT', $data['shop']['currency']);
        $this->assertSame([
            'variant_id' => $juice->id, 'product_name' => 'Juice', 'variant_name' => null, 'sku' => $juice->sku,
            'barcode' => '4006381333931', 'barcode_format' => 'ean13', 'price' => '25.50', 'currency' => 'BDT',
            'unit' => 'pcs', 'quantity' => 1, 'batch_number' => null, 'expires_on' => null,
        ], $data['labels'][0]);
        $this->assertSame([null, 'code128'], [$data['labels'][1]['barcode'], $data['labels'][1]['barcode_format']]);

        $byCategory = $this->getJson("/api/v1/products/labels?category_id={$category}")->assertOk()->json('data.labels');
        $this->assertEqualsCanonicalizing([$juice->id, $rice->id], array_column($byCategory, 'variant_id'));

        $supplier = $this->inTenant($org, fn () => Supplier::query()->create(['organization_id' => $org->id, 'code' => 'S1', 'name' => 'Pran']));
        $store = $this->mainStoreId($org);
        $order = $this->postJson('/api/v1/purchasing/orders', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'quantity' => '12', 'unit_cost' => '10'], ['variant_id' => $rice->id, 'quantity' => '7.5', 'unit_cost' => '50']],
        ])->assertCreated()->json('data');
        $receipt = $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $pills->id, 'quantity' => '30', 'unit_cost' => '2', 'batch_number' => 'B-9', 'expires_on' => '2027-03-31']],
        ])->assertCreated()->json('data');

        $fromOrder = $this->getJson("/api/v1/products/labels?purchase_order_id={$order['id']}")->assertOk()->json('data.labels');
        $this->assertSame([12, 1], array_column($fromOrder, 'quantity'), 'ordered quantity; one label for goods sold by weight');
        $fromReceipt = $this->getJson("/api/v1/products/labels?goods_receipt_id={$receipt['id']}")->assertOk()->json('data.labels.0');
        $this->assertSame([30, 'B-9', '2027-03-31'], [$fromReceipt['quantity'], $fromReceipt['batch_number'], $fromReceipt['expires_on']]);

        $this->getJson('/api/v1/products/labels')->assertStatus(422);
        $this->getJson("/api/v1/products/labels?category_id={$category}&goods_receipt_id={$receipt['id']}")->assertStatus(422);
        $this->getJson('/api/v1/products/labels?goods_receipt_id='.$juice->id)->assertNotFound();

        // A cashier sees product labels but not purchase documents.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/products/labels?'.http_build_query(['variant_ids' => [$juice->id]]))->assertOk();
        $this->getJson("/api/v1/products/labels?goods_receipt_id={$receipt['id']}")->assertForbidden();

        // Another organization's documents and variants are invisible.
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($otherAdmin);
        $this->getJson("/api/v1/products/labels?purchase_order_id={$order['id']}")->assertNotFound();
        $this->getJson('/api/v1/products/labels?'.http_build_query(['variant_ids' => [$juice->id]]))->assertOk()->assertJsonCount(0, 'data.labels');
    }
}
