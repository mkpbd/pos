<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Purchasing\Application\Actions\ChangeRequisitionStatus;
use App\Modules\Purchasing\Application\Actions\ConvertRequisition;
use App\Modules\Purchasing\Application\Actions\RecordSupplierQuote;
use App\Modules\Purchasing\Application\Actions\SaveRequisition;
use App\Modules\Purchasing\Application\Actions\SaveRfq;
use App\Modules\Purchasing\Application\Actions\SendRfq;
use App\Modules\Purchasing\Application\Actions\UpdateApprovalSettings;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Auth;

/**
 * SC2 demo data, through the real use cases (new numbers only; existing documents, numbers
 * and stock untouched):
 * - approval limits saved with the defaults (10 000.00 / 100 000.00, PO approval on);
 * - PR-000001 raised by the cashier and submitted — waiting for manager approval (owner's inbox);
 * - PR-000002 raised by the cashier, approved by the owner and converted into the draft,
 *   pre-approved purchase order PO-000002 (Local Mills Wholesale);
 * - RFQ-000001 for polo shirts sent to Pran and Local Mills (no e-mail addresses: "send
 *   manually"), with Pran's quote recorded.
 */
class DemoProcurementSeeder extends Seeder
{
    public function run(
        string $organizationId,
        string $adminId,
        TenantContext $tenant,
        UpdateApprovalSettings $settings,
        SaveRequisition $saveRequisition,
        ChangeRequisitionStatus $requisitionStatus,
        ConvertRequisition $convert,
        SaveRfq $saveRfq,
        SendRfq $sendRfq,
        RecordSupplierQuote $recordQuote,
    ): void {
        $tenant->runAs($organizationId, function () use ($adminId, $settings, $saveRequisition, $requisitionStatus, $convert, $saveRfq, $sendRfq, $recordQuote) {
            $owner = User::query()->findOrFail($adminId);
            $staff = User::query()
                ->whereHas('roles', fn ($q) => $q->where('system_key', SystemRole::Cashier->value))
                ->orderBy('created_at')
                ->first() ?? $owner;
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $variant = fn (string $product, int $index = 0) => Product::query()->where('name', $product)->firstOrFail()->variants()->get()[$index]->id;
            $pran = Supplier::query()->where('name', 'Pran Distribution Ltd')->firstOrFail();
            $mills = Supplier::query()->where('name', 'Local Mills Wholesale')->firstOrFail();
            $juice = $variant('Pran Mango Juice 250ml');
            $rice = $variant('Miniket Rice');
            $act = function (User $user): void {
                Auth::guard()->setUser($user);
            };

            $act($owner);
            $settings([]);

            // PR-000001: waiting for manager approval (480 × 18.00 + 15 % VAT + 100 kg × 61.00 = 16 036.00).
            $act($staff);
            $waiting = $saveRequisition($staff, null, [
                'store_id' => $store->id,
                'needed_by' => now()->addWeek()->toDateString(),
                'notes' => 'Eid demand: juice and rice running low.',
                'lines' => [
                    ['variant_id' => $juice, 'quantity' => '480', 'suggested_supplier_id' => $pran->id],
                    ['variant_id' => $rice, 'quantity' => '100'],
                ],
            ]);
            $requisitionStatus->submit($staff, $waiting);

            // PR-000002: 250 kg rice (15 250.00), approved by the owner, converted into PO-000002.
            $converted = $saveRequisition($staff, null, [
                'store_id' => $store->id,
                'notes' => 'Monthly rice top-up.',
                'lines' => [['variant_id' => $rice, 'quantity' => '250']],
            ]);
            $requisitionStatus->submit($staff, $converted);
            $act($owner);
            $requisitionStatus->approve($owner, $converted);
            $line = $converted->lines()->firstOrFail();
            $convert($owner, $converted, ['purchase_orders' => ['lines' => [['requisition_line_id' => $line->id, 'supplier_id' => $mills->id]]]]);

            // RFQ-000001: polo shirts from two suppliers, one quote in.
            $rfq = $saveRfq->create($owner, [
                'store_id' => $store->id,
                'title' => 'Cotton polo shirts for the winter season',
                'needed_by' => now()->addDays(21)->toDateString(),
                'reply_by' => now()->addDays(5)->toDateString(),
                'notes' => 'Please quote for plain cotton polo shirts, assorted colours.',
                'supplier_ids' => [$pran->id, $mills->id],
                'lines' => [
                    ['variant_id' => $variant('Cotton Polo Shirt', 0), 'quantity' => '30'],
                    ['variant_id' => $variant('Cotton Polo Shirt', 1), 'quantity' => '30'],
                ],
            ]);
            $rfq = $sendRfq->send($rfq);
            $lines = $rfq->lines()->get();
            $recordQuote($rfq, [
                'supplier_id' => $pran->id,
                'status' => 'received',
                'valid_until' => now()->addDays(30)->toDateString(),
                'notes' => 'Prices per piece, delivery included.',
                'lines' => [
                    ['rfq_line_id' => $lines[0]->id, 'unit_price' => '295.00', 'lead_time_days' => 10],
                    ['rfq_line_id' => $lines[1]->id, 'unit_price' => '305.00', 'quantity_offered' => '25', 'lead_time_days' => 10],
                ],
            ]);

            Auth::guard()->forgetUser();
        });
    }
}
