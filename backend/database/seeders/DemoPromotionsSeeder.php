<?php

namespace Database\Seeders;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Promotions\Application\Actions\SavePromotion;
use App\Modules\Promotions\Infrastructure\Models\Promotion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Database\Seeder;

/**
 * Promotions on the demo storefront (E8b), through the real use case:
 *
 * - "Juice week": automatic flash sale, 10% off the brand Pran, with a countdown, ending
 *   seven days after seeding (shown by the homepage's hot deals section);
 * - "Welcome 50": coupon WELCOME50, 50 off orders from 500, once per customer;
 * - "Free delivery over 3000": automatic free delivery from a 3000 subtotal.
 */
class DemoPromotionsSeeder extends Seeder
{
    public function run(string $organizationId, TenantContext $tenant, SavePromotion $save): void
    {
        $tenant->runAs($organizationId, function () use ($save) {
            $pran = Brand::query()->where('name', 'Pran')->firstOrFail();

            $save(new Promotion, [
                'name' => 'Juice week',
                'description' => '10% off Pran juices and drinks',
                'type' => 'percent',
                'value' => '10',
                'scope' => 'brands',
                'target_ids' => [$pran->id],
                'trigger' => 'automatic',
                'ends_at' => now()->addDays(7)->toIso8601String(),
                'show_countdown' => true,
                'is_active' => true,
            ]);

            $save(new Promotion, [
                'name' => 'Welcome 50',
                'description' => '50 off your order over 500 with code WELCOME50',
                'type' => 'fixed',
                'value' => '50',
                'scope' => 'order',
                'min_subtotal' => '500',
                'trigger' => 'coupon',
                'usage_limit_per_customer' => 1,
                'is_active' => true,
                'coupon_code' => 'WELCOME50',
            ]);

            $save(new Promotion, [
                'name' => 'Free delivery over 3000',
                'description' => 'Free delivery on orders over 3000',
                'type' => 'free_shipping',
                'scope' => 'order',
                'min_subtotal' => '3000',
                'trigger' => 'automatic',
                'is_active' => true,
            ]);
        });
    }
}
