<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Q1: taking an invited supplier off an RFQ — on a draft, or on a sent RFQ while that supplier
 * has not answered (never the last one); refused once they answered or the RFQ is closed,
 * awarded or cancelled; `can_remove` per invite; audited; other organizations see nothing.
 */
class RfqSupplierRemovalTest extends TestCase
{
    use BuildsProcurement, ReadsExports, RefreshDatabase;

    private const BASE = '/api/v1/purchasing/rfqs';

    /**
     * @param  list<string>  $supplierIds
     * @return array<string, mixed>
     */
    private function draftRfq(string $store, string $variantId, array $supplierIds): array
    {
        return $this->postJson(self::BASE, [
            'store_id' => $store, 'title' => 'Eid restock', 'reply_by' => now()->addDays(3)->toDateString(), 'supplier_ids' => $supplierIds,
            'lines' => [['variant_id' => $variantId, 'quantity' => '10']],
        ])->assertCreated()->json('data');
    }

    /**
     * @param  array<string, mixed>  $rfq
     * @return array<string, bool> can_remove by supplier id
     */
    private function removable(array $rfq): array
    {
        return collect($rfq['suppliers'])->mapWithKeys(fn (array $s) => [$s['supplier']['id'] => $s['can_remove']])->all();
    }

    public function test_draft_and_sent_rfqs_lose_suppliers_who_have_not_answered(): void
    {
        $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        [$pran, $mills, $third, $silent] = [$this->supplier($org, 'Pran'), $this->supplier($org, 'Mills'), $this->supplier($org, 'Third'), $this->supplier($org, 'Silent')];
        $this->actingAsUser($admin);
        $rfq = $this->draftRfq($store, $juice->id, [$pran->id, $mills->id, $third->id, $silent->id]);
        $this->assertSame([true, true, true, true], array_values($this->removable($rfq)));

        // Draft: removed (once).
        $rfq = $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$third->id}")->assertOk()->assertJsonCount(3, 'data.suppliers')->json('data');
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$third->id}")->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['supplier_id']]]);

        // Sent: suppliers who answered (a quote or a decline) stay; one who did not can go.
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $pran->id, 'status' => 'received', 'lines' => [['rfq_line_id' => $rfq['lines'][0]['id'], 'unit_price' => '18']]])->assertOk();
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $mills->id, 'status' => 'declined'])->assertOk();
        $rfq = $this->getJson(self::BASE."/{$rfq['id']}")->assertOk()->json('data');
        $this->assertSame([$pran->id => false, $mills->id => false, $silent->id => true], $this->removable($rfq));

        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$pran->id}")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_SUPPLIER_QUOTED');
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$mills->id}")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_SUPPLIER_QUOTED');
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$silent->id}")->assertOk()->assertJsonCount(2, 'data.suppliers');

        $audit = AuditLog::query()->withoutGlobalScopes()->where('subject_id', $rfq['id'])->where('action', 'rfq.supplier_removed')->orderBy('created_at')->get();
        $this->assertSame([$third->id, $silent->id], $audit->map(fn (AuditLog $a) => $a->old_values['supplier_id'])->all());
        $this->assertSame('sent', $audit->last()->context['status']);
    }

    public function test_the_last_supplier_of_a_sent_rfq_stays_and_finished_rfqs_are_locked(): void
    {
        $this->fakePdfRenderer();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        [$pran, $mills] = [$this->supplier($org, 'Pran'), $this->supplier($org, 'Mills')];
        $this->actingAsUser($admin);

        $rfq = $this->draftRfq($store, $juice->id, [$pran->id, $mills->id]);
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$mills->id}")->assertOk();
        $this->assertSame([$pran->id => false], $this->removable($this->getJson(self::BASE."/{$rfq['id']}")->json('data')));
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$pran->id}")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_LAST_SUPPLIER');

        // Closed and cancelled RFQs keep their suppliers.
        $this->transition("rfqs/{$rfq['id']}/close", ['reason' => 'No answers'])->assertOk();
        $this->assertSame([$pran->id => false], $this->removable($this->getJson(self::BASE."/{$rfq['id']}")->json('data')));
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$pran->id}")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_LOCKED');

        $cancelled = $this->draftRfq($store, $juice->id, [$pran->id, $mills->id]);
        $this->transition("rfqs/{$cancelled['id']}/cancel", ['reason' => 'Not needed'])->assertOk();
        $this->deleteJson(self::BASE."/{$cancelled['id']}/suppliers/{$mills->id}")->assertStatus(422)->assertJsonPath('error.code', 'RFQ_LOCKED');
        $this->assertSame(0, AuditLog::query()->withoutGlobalScopes()->where('subject_id', $cancelled['id'])->where('action', 'rfq.supplier_removed')->count());
    }

    public function test_permissions_and_other_organizations(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        ['admin' => $otherAdmin] = $this->procurementWorld('Other Shop');
        [$pran, $mills] = [$this->supplier($org, 'Pran'), $this->supplier($org, 'Mills')];
        $this->actingAsUser($admin);
        $rfq = $this->draftRfq($store, $juice->id, [$pran->id, $mills->id]);

        $this->actingAsUser($otherAdmin)->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$mills->id}")->assertNotFound();

        // Viewing without purchases.manage: nothing is removable, and removing is forbidden.
        $viewer = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $this->assertSame([false, false], array_values($this->removable($this->actingAsUser($viewer)->getJson(self::BASE."/{$rfq['id']}")->assertOk()->json('data'))));
        $this->deleteJson(self::BASE."/{$rfq['id']}/suppliers/{$mills->id}")->assertForbidden();

        $this->assertCount(2, $this->actingAsUser($admin)->getJson(self::BASE."/{$rfq['id']}")->json('data.suppliers'));
    }
}
