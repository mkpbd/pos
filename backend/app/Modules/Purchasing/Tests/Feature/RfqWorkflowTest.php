<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Purchasing\Infrastructure\Notifications\RfqRequestMail;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * SC2: requests for quotation — invitations, sending (PDF per supplier, queued e-mail with the
 * PDF attached), quotes, comparison, split awards into draft purchase orders with an optional
 * catalog update, pre-approval from requisitions, closing, reminders, permissions and isolation.
 */
class RfqWorkflowTest extends TestCase
{
    use BuildsProcurement, ReadsExports, RefreshDatabase;

    /**
     * @param  list<string>  $supplierIds
     * @param  list<array<string, mixed>>  $lines
     */
    private function draftRfq(string $store, array $lines, array $supplierIds, array $extra = []): array
    {
        return $this->postJson('/api/v1/purchasing/rfqs', $extra + [
            'store_id' => $store, 'title' => 'Eid restock', 'reply_by' => now()->addDays(3)->toDateString(), 'supplier_ids' => $supplierIds, 'lines' => $lines,
        ])->assertCreated()->json('data');
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function quote(string $rfqId, string $supplierId, array $lines, array $extra = [], int $status = 200): TestResponse
    {
        return $this->transition("rfqs/{$rfqId}/quotes", $extra + ['supplier_id' => $supplierId, 'status' => 'received', 'lines' => $lines])->assertStatus($status);
    }

    public function test_send_issues_a_pdf_per_supplier_and_emails_those_with_an_address(): void
    {
        $pdf = $this->fakePdfRenderer();
        Notification::fake();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran', ['email' => 'sales@pran.test', 'contact_person' => 'Rahim']);
        $mills = $this->supplier($org, 'Mills');
        $late = $this->supplier($org, 'Late Joiner', ['email' => 'quotes@late.test']);
        $inactive = $this->supplier($org, 'Dormant', ['is_active' => false, 'email' => 'x@dormant.test']);
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/purchasing/rfqs', ['store_id' => $store, 'title' => 'x', 'supplier_ids' => [$inactive->id], 'lines' => [['variant_id' => $juice->id, 'quantity' => '1']]])
            ->assertStatus(422)->assertJsonPath('error.details', ['supplier_ids.0' => ['Dormant is inactive.']]);
        $rfq = $this->draftRfq($store, [['variant_id' => $juice->id, 'quantity' => '48', 'notes' => '250 ml cartons']], [$pran->id], ['reply_by' => null, 'notes' => 'Deliver before Eid']);
        $this->assertSame(['RFQ-000001', 'draft', 1, 1], [$rfq['number'], $rfq['status'], $rfq['line_count'], $rfq['supplier_count']]);

        $this->transition("rfqs/{$rfq['id']}/send")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_SUPPLIERS_REQUIRED')->assertJsonPath('error.details.min', 2);
        $this->putJson("/api/v1/purchasing/rfqs/{$rfq['id']}", ['title' => 'Eid restock', 'supplier_ids' => [$pran->id, $mills->id], 'notes' => 'Deliver before Eid'])
            ->assertOk()->assertJsonCount(2, 'data.suppliers');
        $this->transition("rfqs/{$rfq['id']}/send")->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reply_by']]]);
        $this->putJson("/api/v1/purchasing/rfqs/{$rfq['id']}", ['title' => 'Eid restock', 'reply_by' => now()->subDay()->toDateString()])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reply_by']]]);
        $this->putJson("/api/v1/purchasing/rfqs/{$rfq['id']}", ['title' => 'Eid restock', 'reply_by' => now()->addDays(3)->toDateString(), 'notes' => 'Deliver before Eid'])->assertOk();

        $key = (string) Str::uuid();
        $sent = $this->transition("rfqs/{$rfq['id']}/send", [], $key)->assertOk()->assertJsonPath('data.status', 'sent')->json('data');
        $this->transition("rfqs/{$rfq['id']}/send", [], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $suppliers = collect($sent['suppliers'])->keyBy('supplier.id');
        $this->assertNotNull($suppliers[$pran->id]['emailed_at']);
        $this->assertSame(['sales@pran.test', false], [$suppliers[$pran->id]['emailed_to'], $suppliers[$pran->id]['send_manually']]);
        $this->assertNull($suppliers[$mills->id]['emailed_at']);
        $this->assertSame([false, true], [$suppliers[$mills->id]['has_email'], $suppliers[$mills->id]['send_manually']]);
        $this->assertSame('Sent to 2 suppliers (1 by e-mail).', end($sent['history'])['note']);

        // The e-mail carries the supplier's PDF; the PDF names the items and dates, never prices.
        Notification::assertSentOnDemandTimes(RfqRequestMail::class, 1);
        Notification::assertSentOnDemand(RfqRequestMail::class, function (RfqRequestMail $mail, array $channels, AnonymousNotifiable $to) use ($pran) {
            $message = $mail->toMail($to);
            $this->assertSame('sales@pran.test', $to->routes['mail']);
            $this->assertStringStartsWith('%PDF', $mail->pdf());
            $this->assertSame("{$mail->rfq['number']}-".Str::slug($pran->code).'.pdf', $message->rawAttachments[0]['name']);
            $this->assertSame('Request for quotation RFQ-000001 — Acme Retail', $message->subject);
            $this->assertSame('Dear Rahim,', $message->greeting);

            return true;
        });
        $html = $pdf->lastHtml();
        $sku = $sent['lines'][0]['variant']['sku'];
        foreach (['Request for quotation', 'RFQ-000001', 'Pran', 'Main Store', e($sku), 'Mango Juice', '48', '250 ml cartons', 'Deliver before Eid', now()->addDays(3)->format('d M Y')] as $text) {
            $this->assertStringContainsString($text, $html);
        }
        $this->assertStringNotContainsString('10.00', $html, 'no prices on a request for quotation');

        $this->get("/api/v1/purchasing/rfqs/{$rfq['id']}/suppliers/{$mills->id}/pdf")->assertOk()
            ->assertHeader('Content-Type', 'application/pdf')
            ->assertHeader('Content-Disposition', 'attachment; filename="RFQ-000001-'.Str::slug($mills->code).'.pdf"');
        $this->assertStringContainsString('Mills', $pdf->lastHtml());
        $this->get("/api/v1/purchasing/rfqs/{$rfq['id']}/suppliers/{$late->id}/pdf")->assertNotFound();

        // Locked after sending; a supplier invited now is issued the request at once.
        $this->putJson("/api/v1/purchasing/rfqs/{$rfq['id']}", ['title' => 'Changed'])->assertStatus(422)->assertJsonPath('error.code', 'RFQ_LOCKED');
        $this->transition("rfqs/{$rfq['id']}/send")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
        $this->transition("rfqs/{$rfq['id']}/suppliers", ['supplier_ids' => [$late->id]])->assertOk()->assertJsonCount(3, 'data.suppliers');
        Notification::assertSentOnDemandTimes(RfqRequestMail::class, 2);
        $this->deleteJson("/api/v1/purchasing/rfqs/{$rfq['id']}/suppliers/{$late->id}")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_LOCKED');
    }

    public function test_quotes_comparison_and_split_award_with_catalog_update(): void
    {
        $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $water = $this->stockedVariant($org, 'Water');
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $third = $this->supplier($org, 'Third');
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '20', 'lead_time_days' => 7]);
        $rfq = $this->draftRfq($store, [['variant_id' => $juice->id, 'quantity' => '100'], ['variant_id' => $water->id, 'quantity' => '50']], [$pran->id, $mills->id, $third->id]);
        [$juiceLine, $waterLine] = array_column($rfq['lines'], 'id');

        $this->quote($rfq['id'], $pran->id, [['rfq_line_id' => $juiceLine, 'unit_price' => '18.5']], status: 422)->assertJsonPath('error.code', 'RFQ_NOT_OPEN');
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();

        $this->quote($rfq['id'], $pran->id, [
            ['rfq_line_id' => $juiceLine, 'unit_price' => '18.5', 'lead_time_days' => 5],
            ['rfq_line_id' => $waterLine, 'unit_price' => '9', 'lead_time_days' => 3],
        ], ['valid_until' => now()->addDays(10)->toDateString()]);
        $this->quote($rfq['id'], $mills->id, [['rfq_line_id' => $juiceLine, 'unit_price' => '19', 'quantity_offered' => '60', 'lead_time_days' => 2]]);
        // Recording again replaces the answer.
        $this->quote($rfq['id'], $mills->id, [['rfq_line_id' => $juiceLine, 'unit_price' => '18', 'quantity_offered' => '60', 'lead_time_days' => 2]])
            ->assertJsonPath('data.quote_count', 2);
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $third->id, 'status' => 'declined', 'notes' => 'Out of stock'])->assertOk();
        $this->quote($rfq['id'], $this->supplier($org, 'Stranger')->id, [['rfq_line_id' => $juiceLine, 'unit_price' => '1']], status: 422)
            ->assertJsonPath('error.details.supplier_id.0', 'This supplier was not invited to the RFQ.');
        $this->quote($rfq['id'], $pran->id, [['rfq_line_id' => (string) Str::uuid(), 'unit_price' => '1']], status: 422)
            ->assertJsonPath('error.details', ['lines.0.rfq_line_id' => ['This line is not part of the RFQ.']]);
        $this->quote($rfq['id'], $pran->id, [['rfq_line_id' => $juiceLine, 'unit_price' => '1', 'quantity_offered' => '1.5']], status: 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.quantity_offered']]]);
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $pran->id, 'status' => 'received'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines']]]);

        $comparison = $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}/comparison")->assertOk()
            ->assertJsonPath('data.currency', 'BDT')->assertJsonPath('data.line_count', 2)->json('data');
        $line = $comparison['lines'][0];
        $this->assertSame($juiceLine, $line['line']['id']);
        $this->assertSame([$mills->id], $line['lowest_price_supplier_ids']);
        $this->assertSame([$mills->id], $line['fastest_supplier_ids']);
        $cells = collect($line['quotes'])->keyBy('supplier_id');
        $this->assertSame(['18.0000', '1800.00', true, true, true], [$cells[$mills->id]['unit_price'], $cells[$mills->id]['line_total'], $cells[$mills->id]['lowest_price'], $cells[$mills->id]['fastest'], $cells[$mills->id]['partial']]);
        $this->assertSame([false, false], [$cells[$pran->id]['lowest_price'], $cells[$pran->id]['partial']]);
        $this->assertSame([$pran->id], $comparison['lines'][1]['lowest_price_supplier_ids']);
        $totals = collect($comparison['suppliers'])->keyBy('supplier.id');
        $this->assertSame(['2300.00', 2, 100, true], [$totals[$pran->id]['total'], $totals[$pran->id]['lines_quoted'], $totals[$pran->id]['coverage_percent'], $totals[$pran->id]['complete']]);
        $this->assertSame(['1800.00', 50], [$totals[$mills->id]['total'], $totals[$mills->id]['coverage_percent']]);
        $this->assertSame(['declined', '0.00'], [$totals[$third->id]['status'], $totals[$third->id]['total']]);

        // Award checks: quoted lines only, at most the requested quantity.
        $this->transition("rfqs/{$rfq['id']}/award", ['lines' => [['rfq_line_id' => $waterLine, 'supplier_id' => $mills->id, 'quantity' => '50']]])
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.supplier_id' => ['Mills did not quote this line.']]);
        $this->transition("rfqs/{$rfq['id']}/award", ['lines' => [
            ['rfq_line_id' => $juiceLine, 'supplier_id' => $mills->id, 'quantity' => '60'],
            ['rfq_line_id' => $juiceLine, 'supplier_id' => $pran->id, 'quantity' => '41'],
        ]])->assertStatus(422)->assertJsonPath('error.details', ['lines.1.quantity' => ['Only 100.000 requested on the RFQ for this line.']]);

        $key = (string) Str::uuid();
        $award = ['update_catalog' => true, 'lines' => [
            ['rfq_line_id' => $juiceLine, 'supplier_id' => $mills->id, 'quantity' => '60'],
            ['rfq_line_id' => $juiceLine, 'supplier_id' => $pran->id, 'quantity' => '40'],
            ['rfq_line_id' => $waterLine, 'supplier_id' => $pran->id, 'quantity' => '50'],
        ]];
        $result = $this->transition("rfqs/{$rfq['id']}/award", $award, $key)->assertCreated()
            ->assertJsonPath('data.rfq.status', 'awarded')
            ->assertJsonPath('data.catalog_updated', 3)
            ->json('data');
        $this->transition("rfqs/{$rfq['id']}/award", $award, $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $orders = collect($result['purchase_orders'])->keyBy('supplier.name');
        $this->assertSame(['draft', '1080.00', 1, false], [$orders['Mills']['status'], $orders['Mills']['total'], $orders['Mills']['line_count'], $orders['Mills']['pre_approved']]);
        $this->assertSame(['1190.00', 2], [$orders['Pran']['total'], $orders['Pran']['line_count']]); // 40 × 18.50 + 50 × 9
        $this->assertCount(3, $result['rfq']['awards']);
        $this->assertCount(2, $result['rfq']['purchase_orders']);
        $this->getJson("/api/v1/purchasing/orders/{$orders['Pran']['id']}")->assertJsonPath('data.rfq.number', $rfq['number'])
            ->assertJsonPath('data.requisition', null)->assertJsonPath('data.notes', "Awarded from {$rfq['number']}.")
            ->assertJsonPath('data.lines.0.unit_cost', '18.5000');

        // The catalog took the quoted costs and lead times (updated and created rows).
        $catalog = $this->inTenant($org, fn () => SupplierProduct::query()->get()->mapWithKeys(fn (SupplierProduct $p) => [$p->supplier_id.'|'.$p->variant_id => [$p->unit_cost, $p->lead_time_days]])->all());
        $this->assertSame(['18.5000', 5], $catalog[$pran->id.'|'.$juice->id]);
        $this->assertSame(['9.0000', 3], $catalog[$pran->id.'|'.$water->id]);
        $this->assertSame(['18.0000', 2], $catalog[$mills->id.'|'.$juice->id]);

        $this->quote($rfq['id'], $pran->id, [['rfq_line_id' => $juiceLine, 'unit_price' => '1']], status: 422)->assertJsonPath('error.code', 'RFQ_NOT_OPEN');
        $this->transition("rfqs/{$rfq['id']}/close")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
        // Below the auto limit and not from a requisition: ordered on submit.
        $this->transition("orders/{$orders['Pran']['id']}/submit")->assertOk()->assertJsonPath('data.status', 'ordered');
    }

    public function test_award_from_an_approved_requisition_is_pre_approved_and_releases_the_rest(): void
    {
        $this->fakePdfRenderer();
        ['org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);

        $this->actingAsUser($cashier);
        $requisition = $this->submittedRequisition($store, $juice->id, '1000', '20'); // 20 000.00, manager level
        $this->actingAsUser($manager);
        $this->transition("requisitions/{$requisition['id']}/approve")->assertOk();
        $this->actingAsUser($buyer);
        $rfq = $this->transition("requisitions/{$requisition['id']}/convert", ['rfq' => [
            'lines' => [['requisition_line_id' => $requisition['lines'][0]['id']]], 'reply_by' => now()->addDays(2)->toDateString(), 'supplier_ids' => [$pran->id, $mills->id],
        ]])->assertCreated()->json('data.rfq');
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();
        $lineId = $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertJsonPath('data.title', "Requisition {$requisition['number']}")->json('data.lines.0.id');
        $this->putJson("/api/v1/purchasing/rfqs/{$rfq['id']}", ['title' => 'x', 'lines' => [['variant_id' => $juice->id, 'quantity' => '1']]])->assertStatus(422);
        $this->quote($rfq['id'], $pran->id, [['rfq_line_id' => $lineId, 'unit_price' => '20.50']]);
        $this->quote($rfq['id'], $mills->id, [['rfq_line_id' => $lineId, 'unit_price' => '22']]);

        $order = $this->transition("rfqs/{$rfq['id']}/award", ['lines' => [['rfq_line_id' => $lineId, 'supplier_id' => $pran->id, 'quantity' => '800']]])
            ->assertCreated()->json('data.purchase_orders.0');
        $this->assertSame(['16400.00', '16000.00', true], [$order['total'], $order['approved_amount'], $order['pre_approved']]);
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.requisition.id', $requisition['id'])
            ->assertJsonPath('data.pre_approval_limit', '16800.00')->assertJsonPath('data.submit_requires_approval', false);
        $this->transition("orders/{$order['id']}/submit")->assertOk()->assertJsonPath('data.status', 'ordered'); // above 10 000 but pre-approved

        // The 200 not awarded went back to the requisition.
        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.lines.0.converted_quantity', '800.000')->assertJsonPath('data.lines.0.remaining_quantity', '200.000')
            ->assertJsonPath('data.rfqs.0.status', 'awarded');
    }

    public function test_close_and_daily_reminders_for_missing_quotes(): void
    {
        $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld(); // Asia/Dhaka
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $this->travelTo(CarbonImmutable::parse('2026-11-06 03:00:00', 'UTC')); // 09:00 in Dhaka
        $this->actingAsUser($buyer);
        $rfq = $this->draftRfq($store, [['variant_id' => $juice->id, 'quantity' => '10']], [$pran->id, $mills->id], ['reply_by' => '2026-11-07']);
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();
        $this->quote($rfq['id'], $pran->id, [['rfq_line_id' => $rfq['lines'][0]['id'], 'unit_price' => '18']]);
        $unread = fn () => $this->actingAsUser($buyer)->getJson('/api/v1/notifications/unread-count')->json('data.count');

        // Not overdue on the reply-by day itself.
        $this->travelTo(CarbonImmutable::parse('2026-11-07 03:00:00', 'UTC'));
        $this->artisan('purchasing:rfq-reminders')->expectsOutputToContain('Sent 0 RFQ reminder(s).')->assertSuccessful();
        // The day after, from 07:00 local: once.
        $this->travelTo(CarbonImmutable::parse('2026-11-08 00:30:00', 'UTC')); // 06:30 in Dhaka
        $this->artisan('purchasing:rfq-reminders')->expectsOutputToContain('Sent 0 RFQ reminder(s).');
        $this->travelTo(CarbonImmutable::parse('2026-11-08 02:00:00', 'UTC'));
        $this->artisan('purchasing:rfq-reminders')->expectsOutputToContain('Sent 1 RFQ reminder(s).');
        $this->artisan('purchasing:rfq-reminders')->expectsOutputToContain('Sent 0 RFQ reminder(s).');
        $this->assertSame(1, $unread());
        $note = $this->getJson('/api/v1/notifications')->json('data.0');
        $this->assertSame('purchasing.rfq_replies_overdue', $note['type']);
        $this->assertSame("1 supplier has not answered {$rfq['number']} (reply by 2026-11-07).", $note['data']['message']);
        $this->assertSame([$mills->id], $note['data']['supplier_ids']);
        $this->assertSame(0, $this->actingAsUser($admin)->getJson('/api/v1/notifications/unread-count')->json('data.count'));

        // Daily while quotes are missing; nothing once the RFQ is closed.
        $this->travelTo(CarbonImmutable::parse('2026-11-09 02:00:00', 'UTC'));
        $this->artisan('purchasing:rfq-reminders')->expectsOutputToContain('Sent 1 RFQ reminder(s).');
        $this->actingAsUser($buyer);
        $this->transition("rfqs/{$rfq['id']}/close", ['reason' => 'Going with Pran'])->assertOk()->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.can_award', false);
        $this->travelTo(CarbonImmutable::parse('2026-11-10 02:00:00', 'UTC'));
        $this->artisan('purchasing:rfq-reminders')->expectsOutputToContain('Sent 0 RFQ reminder(s).');
        $this->assertSame(2, $unread());

        $events = collect(app(Schedule::class)->events())->filter(fn ($e) => str_contains((string) $e->command, 'purchasing:rfq-reminders'));
        $this->assertCount(1, $events);
        $this->assertSame('0 * * * *', $events->first()->expression);
    }

    public function test_permissions_branch_scoping_isolation_and_exports(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'branch' => $main, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $north = $this->createBranch($org, 'NORTH');
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$main->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        ['admin' => $foreign, 'organization' => $foreignOrg] = $this->provisionTenant('Other Co');
        $this->actingAsUser($admin);
        $rfq = $this->draftRfq($store, [['variant_id' => $juice->id, 'quantity' => '10']], [$pran->id, $mills->id]);

        $this->actingAsUser($cashier)->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertForbidden();
        $this->actingAsUser($accountant)->getJson('/api/v1/purchasing/rfqs')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertOk()->assertJsonPath('data.can_send', false);
        $this->transition("rfqs/{$rfq['id']}/send")->assertForbidden();
        $this->postJson('/api/v1/purchasing/rfqs', ['store_id' => $store, 'title' => 'x', 'lines' => [['variant_id' => $juice->id, 'quantity' => '1']]])->assertForbidden();

        $this->actingAsUser($northManager)->getJson('/api/v1/purchasing/rfqs')->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertNotFound();
        $this->transition("rfqs/{$rfq['id']}/send")->assertNotFound();
        $this->get("/api/v1/purchasing/rfqs/{$rfq['id']}/suppliers/{$pran->id}/pdf")->assertNotFound();

        $this->actingAsUser($foreign)->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertNotFound();
        $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}/comparison")->assertNotFound();
        $this->getJson('/api/v1/purchasing/rfqs')->assertJsonCount(0, 'data');
        $foreignSupplier = $this->supplier($foreignOrg, 'Theirs');
        $this->actingAsUser($admin)->transition("rfqs/{$rfq['id']}/suppliers", ['supplier_ids' => [$foreignSupplier->id]])
            ->assertStatus(422)->assertJsonPath('error.details', ['supplier_ids.0' => ['The selected supplier does not exist.']]);

        // Lists export like every other list.
        $this->getJson('/api/v1/purchasing/rfqs?status=draft&search=Eid')->assertJsonCount(1, 'data')->assertJsonPath('data.0.supplier_count', 2);
        $rows = $this->xlsxRows($this->get('/api/v1/purchasing/rfqs?export=xlsx')->assertOk());
        $this->assertSame(['RFQ', 'Title'], array_slice($rows[0], 0, 2));
        $this->assertSame($rfq['number'], $rows[1][0]);
        $this->get('/api/v1/purchasing/rfqs?export=pdf')->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringContainsString($rfq['number'], $pdf->lastHtml());
    }
}
