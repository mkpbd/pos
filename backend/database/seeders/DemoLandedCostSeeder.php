<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Purchasing\Application\Actions\ChangePurchaseOrderStatus;
use App\Modules\Purchasing\Application\Actions\PostGoodsReceipt;
use App\Modules\Purchasing\Application\Actions\PostLandedCostVoucher;
use App\Modules\Purchasing\Application\Actions\PostPurchaseReturn;
use App\Modules\Purchasing\Application\Actions\SaveLandedCostVoucher;
use App\Modules\Purchasing\Application\Actions\SavePurchaseOrder;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Actions\SaveSupplier;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;

/**
 * SC3 demo data, through the real use cases. Only the Cotton Polo Shirt sizes L and XL are
 * bought (no reorder rule, nothing the full-stack tests count); juice, rice and the M shirt,
 * Pran's and Local Mills' balances and every existing number stay as they were.
 * - Two new suppliers: Dhaka Apparel Sourcing (shirts) and Sundarban Freight Services (freight
 *   forwarder / customs agent).
 * - PO-000003 (ordered 40 days ago, expected 30 days ago) received 27 days ago, late and short
 *   (L 15 of 15, XL 6 of 10), as GRN-000002 with a sea freight charge of 600.00 + 90.00 VAT
 *   billed by Sundarban (value allocation) and 150.00 handling on Apparel's own invoice
 *   (quantity allocation); 2 XL returned for stitching defects (PRN-000001).
 * - PO-000004 (ordered 20 days ago, expected 12 days ago) received in full on time 13 days ago
 *   (GRN-000003).
 * - LCV-000001 from Sundarban 10 days ago: 800.00 customs duty on GRN-000002 by value, posted —
 *   the share of the 2 returned XL shirts (80.00) is expensed ("Landed cost on sold stock"),
 *   the rest raises the shirts' average cost.
 * Together with RFQ-000001 (SC2) this gives the supplier performance page some history.
 */
class DemoLandedCostSeeder extends Seeder
{
    public function run(
        string $organizationId,
        string $adminId,
        TenantContext $tenant,
        SaveSupplier $saveSupplier,
        SavePurchaseOrder $saveOrder,
        ChangePurchaseOrderStatus $orderStatus,
        PostGoodsReceipt $postReceipt,
        PostPurchaseReturn $postReturn,
        SaveLandedCostVoucher $saveVoucher,
        PostLandedCostVoucher $postVoucher,
        OrganizationDate $dates,
    ): void {
        $tenant->runAs($organizationId, function () use ($adminId, $saveSupplier, $saveOrder, $orderStatus, $postReceipt, $postReturn, $saveVoucher, $postVoucher, $dates) {
            $admin = User::query()->findOrFail($adminId);
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $polo = Product::query()->where('name', 'Cotton Polo Shirt')->firstOrFail()->variants()->get();
            [$large, $extraLarge] = [$polo[1]->id, $polo[2]->id];
            $today = CarbonImmutable::parse($dates->today());
            $day = fn (int $daysAgo) => $today->subDays($daysAgo)->toDateString();

            $apparel = $saveSupplier(null, ['name' => 'Dhaka Apparel Sourcing', 'contact_person' => 'Nasrin Akter', 'phone' => '01700000003', 'payment_terms_days' => 15]);
            $freight = $saveSupplier(null, ['name' => 'Sundarban Freight Services', 'phone' => '01700000004', 'payment_terms_days' => 7]);

            // PO-000003: late and short.
            $late = $saveOrder($admin, null, [
                'supplier_id' => $apparel->id, 'store_id' => $store->id, 'order_date' => $day(40), 'expected_date' => $day(30),
                'lines' => [
                    ['variant_id' => $large, 'quantity' => '15', 'unit_cost' => '280.00', 'tax_rate' => '15'],
                    ['variant_id' => $extraLarge, 'quantity' => '10', 'unit_cost' => '300.00', 'tax_rate' => '15'],
                ],
            ]);
            $late = $orderStatus->place($late);
            $lines = $late->lines()->get()->keyBy('variant_id');
            $receipt = $postReceipt($admin, [
                'supplier_id' => $apparel->id, 'store_id' => $store->id, 'purchase_order_id' => $late->id,
                'supplier_invoice_number' => 'DAS-2207', 'invoice_date' => $day(27),
                'lines' => [
                    ['variant_id' => $large, 'purchase_order_line_id' => $lines[$large]->id, 'quantity' => '15', 'unit_cost' => '280.00', 'tax_rate' => '15'],
                    ['variant_id' => $extraLarge, 'purchase_order_line_id' => $lines[$extraLarge]->id, 'quantity' => '6', 'unit_cost' => '300.00', 'tax_rate' => '15'],
                ],
                'charges' => [
                    ['type' => 'freight', 'description' => 'Sea freight Chattogram → Dhaka', 'amount' => '600.00', 'tax_amount' => '90.00', 'allocation' => 'value', 'charge_supplier_id' => $freight->id],
                    ['type' => 'handling', 'description' => 'Packing and loading', 'amount' => '150.00', 'tax_amount' => '0', 'allocation' => 'quantity'],
                ],
            ]);
            $xl = $receipt->lines()->where('variant_id', $extraLarge)->firstOrFail();
            $postReturn($admin, $receipt, ['reason' => 'Stitching defects', 'lines' => [['goods_receipt_line_id' => $xl->id, 'quantity' => '2']]]);

            // PO-000004: on time and complete.
            $onTime = $saveOrder($admin, null, [
                'supplier_id' => $apparel->id, 'store_id' => $store->id, 'order_date' => $day(20), 'expected_date' => $day(12),
                'lines' => [['variant_id' => $large, 'quantity' => '10', 'unit_cost' => '285.00', 'tax_rate' => '15']],
            ]);
            $onTime = $orderStatus->place($onTime);
            $postReceipt($admin, [
                'supplier_id' => $apparel->id, 'store_id' => $store->id, 'purchase_order_id' => $onTime->id,
                'supplier_invoice_number' => 'DAS-2251', 'invoice_date' => $day(13),
                'lines' => [['variant_id' => $large, 'purchase_order_line_id' => $onTime->lines()->firstOrFail()->id, 'quantity' => '10', 'unit_cost' => '285.00', 'tax_rate' => '15']],
            ]);

            // LCV-000001: customs duty billed later by the forwarder.
            $voucher = $saveVoucher->save($admin, null, [
                'branch_id' => $store->branch_id,
                'voucher_date' => $day(10),
                'charge_supplier_id' => $freight->id,
                'reference' => 'SFS-INV-5521',
                'notes' => 'Customs duty and port charges for the DAS-2207 shipment.',
                'charges' => [['type' => 'duty', 'description' => 'Customs duty and port charges', 'amount' => '800.00', 'tax_amount' => '0', 'allocation' => 'value']],
                'receipt_ids' => [$receipt->id],
            ]);
            $postVoucher($admin, $voucher);
        });
    }
}
