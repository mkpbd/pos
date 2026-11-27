<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ST2b: the delivery challan of a stock transfer (PDF).
 */
class TransferChallanTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    public function test_challan_lists_stores_batches_quantities_and_signatures_without_prices(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $pills = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $from = $this->mainStoreId($org);
        $to = $north->stores()->firstOrFail()->id;
        $this->actingAsUser($admin)->adjust($from, 'opening', ['variant_id' => $pills->id, 'quantity' => '10', 'unit_cost' => '6.75', 'batch_number' => 'B-77', 'expires_on' => '2027-03-31']);
        $transfer = $this->postJson('/api/v1/inventory/transfers', [
            'from_store_id' => $from, 'to_store_id' => $to, 'note' => 'Handle with care',
            'lines' => [['variant_id' => $pills->id, 'quantity' => '4', 'batch_id' => $this->getJson('/api/v1/inventory/batches')->json('data.0.batch.id')]],
        ])->assertCreated()->json('data');

        $this->get("/api/v1/inventory/transfers/{$transfer['id']}/challan.pdf")->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('Content-Disposition', 'inline; filename="TRF-000001-challan.pdf"');
        $html = $pdf->lastHtml();
        foreach (['Delivery challan', 'TRF-000001', 'In transit', 'Main Store', 'Branch NORTH', 'Paracetamol', 'B-77', '31 Mar 2027', 'Quantity sent', 'Handle with care', 'Dispatched by', 'Received by', e($admin->name)] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertStringNotContainsString('Damaged', $html, 'received columns only once received');
        $this->assertStringNotContainsString('6.75', $html, 'no prices on a challan');

        // Once received, the challan shows what arrived and what was damaged.
        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive")->assertOk();
        DB::table('stock_transfer_lines')->where('stock_transfer_id', $transfer['id'])
            ->update(['received_quantity' => '3', 'damaged_quantity' => '1', 'receive_note' => 'One strip crushed']);
        $this->get("/api/v1/inventory/transfers/{$transfer['id']}/challan.pdf")->assertOk();
        $html = $pdf->lastHtml();
        foreach (['Received', 'Damaged', 'One strip crushed', '>3<'] as $text) {
            $this->assertStringContainsString($text, $html);
        }
    }

    public function test_challan_follows_branch_access_and_tenant_isolation(): void
    {
        $this->fakePdfRenderer();
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $south = $this->createBranch($org, 'SOUTH');
        $variant = $this->stockedVariant($org);
        $from = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($from, 'opening', ['variant_id' => $variant->id, 'quantity' => '5', 'unit_cost' => '2']);
        $id = $this->postJson('/api/v1/inventory/transfers', [
            'from_store_id' => $from, 'to_store_id' => $north->stores()->firstOrFail()->id,
            'lines' => [['variant_id' => $variant->id, 'quantity' => '2']],
        ])->assertCreated()->json('data.id');
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $southManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$south->id]);
        ['admin' => $foreign] = $this->provisionTenant('Other Co');

        $this->actingAsUser($northManager)->get("/api/v1/inventory/transfers/{$id}/challan.pdf")->assertOk();
        $this->actingAsUser($southManager)->get("/api/v1/inventory/transfers/{$id}/challan.pdf")->assertNotFound();
        $this->actingAsUser($foreign)->get("/api/v1/inventory/transfers/{$id}/challan.pdf")->assertNotFound();
    }

    public function test_missing_chrome_is_reported_as_pdf_unavailable(): void
    {
        config(['pdf.chrome_path' => base_path('missing/chrome.exe')]);
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $variant = $this->stockedVariant($org);
        $from = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($from, 'opening', ['variant_id' => $variant->id, 'quantity' => '5', 'unit_cost' => '2']);
        $id = $this->postJson('/api/v1/inventory/transfers', [
            'from_store_id' => $from, 'to_store_id' => $north->stores()->firstOrFail()->id,
            'lines' => [['variant_id' => $variant->id, 'quantity' => '2']],
        ])->json('data.id');

        $this->getJson("/api/v1/inventory/transfers/{$id}/challan.pdf")->assertStatus(503)->assertJsonPath('error.code', 'PDF_UNAVAILABLE');
    }
}
