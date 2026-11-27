<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Purchasing\Infrastructure\Notifications\PurchaseOrderMail;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ST2b: the purchase order and goods receipt as PDF, and e-mailing the purchase order.
 */
class PurchaseDocumentsTest extends TestCase
{
    use BuildsProcurement, ReadsExports, RefreshDatabase;

    /**
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function order(string $supplierId, string $store, string $variantId, array $extra = []): array
    {
        return $this->postJson('/api/v1/purchasing/orders', $extra + [
            'supplier_id' => $supplierId, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $variantId, 'quantity' => '10', 'bonus_quantity' => '1', 'unit_cost' => '18.50', 'tax_rate' => '15', 'discount_percent' => '5']],
        ])->assertCreated()->json('data');
    }

    public function test_purchase_order_pdf_shows_supplier_lines_totals_and_terms(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran', ['email' => 'sales@pran.test', 'contact_person' => 'Rahim', 'payment_terms_days' => 30]);
        $this->actingAsUser($admin);
        $order = $this->order($pran->id, $store, $juice->id, ['notes' => 'Deliver to the back gate', 'expected_date' => now()->addWeek()->toDateString()]);

        $this->get("/api/v1/purchasing/orders/{$order['id']}/pdf")->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('Content-Disposition', 'inline; filename="'.$order['number'].'-'.Str::slug($pran->code).'.pdf"');
        $html = $pdf->lastHtml();
        // 10 × 18.50 = 185.00 − 5 % = 175.75; tax 15 % = 26.36; total 202.11.
        foreach (['Purchase order', $order['number'], 'Pran', 'Rahim', 'sales@pran.test', 'Main Store', 'Mango Juice', 'Free qty', 'Disc %', '18.50', '175.75', '26.36', '202.11', 'Net 30 days', 'Deliver to the back gate', now()->addWeek()->format('d M Y')] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertStringContainsString('Page <span class="pageNumber">', $pdf->rendered[0]['footer']);
    }

    public function test_goods_receipt_pdf_shows_invoice_lines_effective_cost_and_charges(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $receipt = $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'invoice_date' => '2026-11-20', 'supplier_invoice_number' => 'INV-5521',
            'lines' => [['variant_id' => $juice->id, 'quantity' => '10', 'bonus_quantity' => '2', 'unit_cost' => '18.50', 'tax_rate' => '15', 'discount_percent' => '5']],
            'charges' => [['type' => 'freight', 'description' => 'Truck', 'amount' => '100', 'tax_amount' => '15', 'allocation' => 'value']],
        ])->assertCreated()->json('data');

        $this->get("/api/v1/purchasing/receipts/{$receipt['id']}/pdf")->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('Content-Disposition', 'inline; filename="'.$receipt['number'].'-'.Str::slug($pran->code).'.pdf"');
        $html = $pdf->lastHtml();
        // 175.75 ÷ 12 units = 14.6458 effective; payable = 202.11 + 100 + 15.
        foreach (['Goods receipt', $receipt['number'], 'Pran', 'INV-5521', '20 Nov 2026', 'Mango Juice', 'Effective cost', '14.6458', '175.75', '202.11', 'Freight', 'Truck', '100.00', '317.11'] as $text) {
            $this->assertStringContainsString($text, $html);
        }
    }

    public function test_email_sends_the_pdf_to_the_supplier_and_records_it(): void
    {
        $this->fakePdfRenderer();
        Notification::fake();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran', ['email' => 'sales@pran.test', 'contact_person' => 'Rahim']);
        $mills = $this->supplier($org, 'Mills');
        $this->actingAsUser($admin);
        $order = $this->order($pran->id, $store, $juice->id);

        // Drafts cannot be e-mailed.
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email")
            ->assertStatus(422)->assertJsonPath('error.code', 'PURCHASE_ORDER_NOT_ORDERED')->assertJsonPath('error.details.status', 'draft');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();

        $sent = $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email")->assertOk()
            ->assertJsonPath('data.emailed_to', 'sales@pran.test')->json('data');
        $this->assertNotNull($sent['emailed_at']);
        Notification::assertSentOnDemandTimes(PurchaseOrderMail::class, 1);
        Notification::assertSentOnDemand(PurchaseOrderMail::class, function (PurchaseOrderMail $mail, array $channels, AnonymousNotifiable $to) use ($order, $pran) {
            $message = $mail->toMail($to);
            $this->assertSame('sales@pran.test', $to->routes['mail']);
            $this->assertStringStartsWith('%PDF', $mail->pdf());
            $this->assertSame($order['number'].'-'.Str::slug($pran->code).'.pdf', $message->rawAttachments[0]['name']);
            $this->assertSame("Purchase order {$order['number']} — Acme Retail", $message->subject);
            $this->assertSame('Dear Rahim,', $message->greeting);

            return true;
        });
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.emailed_to', 'sales@pran.test')
            ->assertJsonPath('data.emailed_at', $sent['emailed_at']);

        // Another address on request; invalid addresses are refused.
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email", ['to' => 'buyer@pran.test'])->assertOk()->assertJsonPath('data.emailed_to', 'buyer@pran.test');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email", ['to' => 'not-an-address'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['to']]]);
        Notification::assertSentOnDemandTimes(PurchaseOrderMail::class, 2);
        $audit = AuditLog::query()->withoutGlobalScopes()->where('subject_id', $order['id'])->where('action', 'purchase_order.emailed')->orderBy('created_at')->get();
        $this->assertSame(['sales@pran.test', 'buyer@pran.test'], $audit->map(fn (AuditLog $a) => $a->new_values['emailed_to'])->all());

        // A supplier without an address needs one given.
        $millsOrder = $this->order($mills->id, $store, $juice->id);
        $this->postJson("/api/v1/purchasing/orders/{$millsOrder['id']}/place")->assertOk();
        $this->postJson("/api/v1/purchasing/orders/{$millsOrder['id']}/email")->assertStatus(422)
            ->assertJsonPath('error.details.to.0', 'Mills has no e-mail address; enter one.');
        $this->postJson("/api/v1/purchasing/orders/{$millsOrder['id']}/email", ['to' => 'orders@mills.test'])->assertOk();
        Notification::assertSentOnDemandTimes(PurchaseOrderMail::class, 3);
    }

    public function test_missing_chrome_stops_the_email(): void
    {
        config(['pdf.chrome_path' => base_path('missing/chrome.exe')]);
        Notification::fake();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran', ['email' => 'sales@pran.test']);
        $this->actingAsUser($admin);
        $order = $this->order($pran->id, $store, $juice->id);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();

        $this->getJson("/api/v1/purchasing/orders/{$order['id']}/pdf")->assertStatus(503)->assertJsonPath('error.code', 'PDF_UNAVAILABLE');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email")->assertStatus(503)->assertJsonPath('error.code', 'PDF_UNAVAILABLE');
        Notification::assertNothingSent();
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.emailed_at', null);
    }

    public function test_permissions_branch_scoping_and_isolation(): void
    {
        $this->fakePdfRenderer();
        Notification::fake();
        ['admin' => $admin, 'org' => $org, 'branch' => $main, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran', ['email' => 'sales@pran.test']);
        $this->actingAsUser($admin);
        $order = $this->order($pran->id, $store, $juice->id);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();
        $receipt = $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'quantity' => '1', 'unit_cost' => '10']],
        ])->assertCreated()->json('data');
        $north = $this->createBranch($org, 'NORTH');
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$main->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        ['admin' => $foreign] = $this->provisionTenant('Other Co');

        $this->actingAsUser($accountant)->get("/api/v1/purchasing/orders/{$order['id']}/pdf")->assertOk();
        $this->get("/api/v1/purchasing/receipts/{$receipt['id']}/pdf")->assertOk();
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email")->assertForbidden();

        $this->actingAsUser($cashier)->get("/api/v1/purchasing/orders/{$order['id']}/pdf")->assertForbidden();
        $this->get("/api/v1/purchasing/receipts/{$receipt['id']}/pdf")->assertForbidden();

        foreach ([$northManager, $foreign] as $outsider) {
            $this->actingAsUser($outsider)->get("/api/v1/purchasing/orders/{$order['id']}/pdf")->assertNotFound();
            $this->get("/api/v1/purchasing/receipts/{$receipt['id']}/pdf")->assertNotFound();
            $this->postJson("/api/v1/purchasing/orders/{$order['id']}/email")->assertNotFound();
        }
        Notification::assertNothingSent();
    }
}
