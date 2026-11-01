<?php

namespace Database\Seeders;

use App\Modules\OnlinePayments\Application\Actions\ConfigurePaymentMethod;
use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shipping\Application\Actions\ManageCouriers;
use App\Modules\Shipping\Application\Actions\ManageShippingMethods;
use App\Modules\Shipping\Application\Actions\ManageShippingZones;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Checkout on the demo storefront (E8a), through the real use cases: two delivery zones —
 * "Inside Dhaka" (Dhaka district: home delivery 60, free from 2000, ETA 1–2 days) and
 * "Outside Dhaka" (every other district: courier 120, COD fee 20, ETA 3–5 days) — cash on
 * delivery, and bank transfer with plain demo instructions and a 48-hour hold; couriers
 * Pathao (with a tracking link), Steadfast and RedX (E10a). No demo orders are placed here
 * (DemoAccountSeeder places the shopper's).
 */
class DemoCheckoutSeeder extends Seeder
{
    public function run(
        string $organizationId,
        TenantContext $tenant,
        ManageShippingZones $zones,
        ManageShippingMethods $methods,
        ConfigurePaymentMethod $payments,
        ManageCouriers $couriers,
    ): void {
        $tenant->runAs($organizationId, function () use ($zones, $methods, $payments, $couriers) {
            $dhaka = (int) DB::table('geo_districts')->where('name_en', 'Dhaka')->value('id');
            $others = DB::table('geo_districts')->where('id', '!=', $dhaka)->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();

            $inside = $zones->create(['name' => 'Inside Dhaka', 'is_active' => true, 'sort_order' => 0, 'district_ids' => [$dhaka]]);
            $methods->create($inside, [
                'name' => 'Home delivery',
                'description' => 'Delivered to your door inside Dhaka.',
                'fee' => '60.00',
                'free_over' => '2000.00',
                'cod_allowed' => true,
                'cod_fee' => '0.00',
                'eta_min_days' => 1,
                'eta_max_days' => 2,
            ]);

            $outside = $zones->create(['name' => 'Outside Dhaka', 'is_active' => true, 'sort_order' => 1, 'district_ids' => $others]);
            $methods->create($outside, [
                'name' => 'Courier delivery',
                'description' => 'Nationwide courier.',
                'fee' => '120.00',
                'free_over' => null,
                'cod_allowed' => true,
                'cod_fee' => '20.00',
                'eta_min_days' => 3,
                'eta_max_days' => 5,
            ]);

            // Couriers (E10a).
            $couriers->create(['name' => 'Pathao', 'tracking_url_template' => 'https://merchant.pathao.com/tracking?consignment_id={tracking}', 'sort_order' => 0]);
            $couriers->create(['name' => 'Steadfast', 'sort_order' => 1]);
            $couriers->create(['name' => 'RedX', 'sort_order' => 2]);

            $payments(GatewayCode::CashOnDelivery, ['is_enabled' => true]);
            $payments(GatewayCode::BankTransfer, [
                'is_enabled' => true,
                'instructions' => 'Demo Bank, account 0000000000 — demo only. Use your order number as the payment reference.',
                'settings' => ['hold_hours' => 48],
            ]);
        });
    }
}
