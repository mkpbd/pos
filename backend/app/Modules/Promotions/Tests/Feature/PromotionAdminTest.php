<?php

namespace App\Modules\Promotions\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Staff API: promotions, coupon codes and redemptions (E8b).
 */
class PromotionAdminTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.coupon_rate_limit' => 1000]);
        $this->buildShop();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function body(array $overrides = []): array
    {
        return $overrides + [
            'name' => 'Shirt sale',
            'description' => '10% off shirts',
            'type' => 'percent',
            'value' => '10',
            'scope' => 'products',
            'target_ids' => [$this->productOf($this->v['SHIRT'])],
            'trigger' => 'automatic',
        ];
    }

    public function test_staff_create_list_show_update_and_delete_promotions(): void
    {
        $shirt = $this->productOf($this->v['SHIRT']);
        $created = $this->postJson('/api/v1/promotions', $this->body([
            'ends_at' => now()->addDays(3)->toIso8601String(),
            'show_countdown' => true,
            'max_discount' => '500',
        ]))->assertCreated()->json('data');
        $this->assertSame(['Shirt sale', '10% off shirts', 'percent', '10.00', 'products', 'automatic', true, true, 'active', 0, 0, '0.00', '500.00', null], [
            $created['name'], $created['description'], $created['type'], $created['value'], $created['scope'], $created['trigger'],
            $created['show_countdown'], $created['is_active'], $created['state'], $created['coupon_count'], $created['redemption_count'],
            $created['discount_total'], $created['max_discount'], $created['min_subtotal'],
        ]);
        $this->assertSame([['id' => $shirt, 'name' => 'Shirt']], $created['targets']);
        $this->assertSame([], $created['coupons_preview']);

        $coupon = $this->postJson('/api/v1/promotions', [
            'name' => 'Welcome 50', 'type' => 'fixed', 'value' => '50', 'scope' => 'order', 'min_subtotal' => '500',
            'trigger' => 'coupon', 'usage_limit_per_customer' => 1, 'coupon_code' => 'welcome50',
        ])->assertCreated()->json('data');
        $this->assertSame(['WELCOME50'], $coupon['coupons_preview']);
        $this->assertSame(1, $coupon['coupon_count']);
        $scheduled = $this->postJson('/api/v1/promotions', $this->body(['name' => 'Later', 'starts_at' => now()->addDay()->toIso8601String()]))->assertCreated()->json('data');
        $this->assertSame('scheduled', $scheduled['state']);
        $off = $this->postJson('/api/v1/promotions', $this->body(['name' => 'Off', 'is_active' => false]))->assertCreated()->json('data');
        $this->postJson('/api/v1/promotions', $this->body(['name' => 'Past', 'starts_at' => now()->subDays(3)->toIso8601String(), 'ends_at' => now()->subDay()->toIso8601String()]))->assertCreated();

        $list = $this->getJson('/api/v1/promotions')->assertOk();
        $this->assertSame(5, $list->json('meta.pagination.total'));
        $this->assertSame(['id', 'name', 'type', 'value', 'scope', 'trigger', 'starts_at', 'ends_at', 'show_countdown', 'is_active', 'state', 'coupon_count', 'redemption_count', 'discount_total'], array_keys($list->json('data.0')));
        $names = fn (string $query) => array_column($this->getJson('/api/v1/promotions?'.$query)->assertOk()->json('data'), 'name');
        $this->assertEqualsCanonicalizing(['Shirt sale', 'Welcome 50'], $names('status=active'));
        $this->assertSame(['Later'], $names('status=scheduled'));
        $this->assertSame(['Past'], $names('status=expired'));
        $this->assertSame(['Off'], $names('status=inactive'));
        $this->assertSame(['Welcome 50'], $names('trigger=coupon'));
        $this->assertSame(['Welcome 50'], $names('search=welcome'));
        $this->getJson('/api/v1/promotions?status=running')->assertUnprocessable();

        $updated = $this->patchJson("/api/v1/promotions/{$created['id']}", ['name' => 'Shirt week', 'value' => '15'])->assertOk()->json('data');
        $this->assertSame(['Shirt week', '15.00', [['id' => $shirt, 'name' => 'Shirt']]], [$updated['name'], $updated['value'], $updated['targets']]);
        $this->assertSame('Shirt week', $this->getJson("/api/v1/promotions/{$created['id']}")->assertOk()->json('data.name'));

        $this->deleteJson("/api/v1/promotions/{$off['id']}")->assertNoContent();
        $this->getJson("/api/v1/promotions/{$off['id']}")->assertNotFound();
    }

    public function test_promotion_rules_are_field_errors(): void
    {
        $invalid = fn (array $body, string $field) => $this->postJson('/api/v1/promotions', $body)
            ->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonValidationErrors($field, 'error.details');

        $invalid($this->body(['type' => 'free_shipping']), 'scope');
        $invalid($this->body(['show_countdown' => true]), 'show_countdown');
        $invalid($this->body(['show_countdown' => true, 'ends_at' => now()->addDay()->toIso8601String(), 'trigger' => 'coupon']), 'show_countdown');
        $invalid(['name' => 'X', 'type' => 'percent', 'value' => '10', 'scope' => 'order', 'trigger' => 'automatic', 'show_countdown' => true, 'ends_at' => now()->addDay()->toIso8601String()], 'show_countdown');
        $invalid($this->body(['value' => '150']), 'value');
        $invalid($this->body(['value' => '0']), 'value');
        $invalid($this->body(['type' => 'fixed', 'value' => null]), 'value');
        $invalid($this->body(['starts_at' => '2026-12-01T10:00:00+06:00', 'ends_at' => '2026-12-01T10:00:00+06:00']), 'ends_at');
        $invalid($this->body(['target_ids' => []]), 'target_ids');
        $invalid($this->body(['target_ids' => ['01900000-0000-7000-8000-000000000000']]), 'target_ids');
        $invalid($this->body(['scope' => 'order']), 'target_ids');
        $invalid($this->body(['scope' => 'brands']), 'target_ids');
        $invalid($this->body(['coupon_code' => 'ABC']), 'coupon_code');
        $invalid($this->body(['name' => str_repeat('x', 81)]), 'name');
        $invalid($this->body(['usage_limit' => 0]), 'usage_limit');

        // Free shipping: no value needed; it is stored as 0 and never capped.
        $free = $this->postJson('/api/v1/promotions', ['name' => 'Free delivery', 'type' => 'free_shipping', 'scope' => 'order', 'trigger' => 'automatic', 'min_subtotal' => '3000', 'max_discount' => '10'])
            ->assertCreated()->json('data');
        $this->assertSame(['0.00', null, '3000.00'], [$free['value'], $free['max_discount'], $free['min_subtotal']]);

        // Category targets of the organization; another organization's ids do not exist here.
        $category = $this->category($this->tenant['organization'], 'Drinks');
        $this->postJson('/api/v1/promotions', $this->body(['scope' => 'categories', 'target_ids' => [$category]]))->assertCreated()
            ->assertJsonPath('data.targets', [['id' => $category, 'name' => 'Drinks']]);

        // The trigger is fixed once codes exist.
        $coupon = $this->postJson('/api/v1/promotions', $this->body(['trigger' => 'coupon', 'coupon_code' => 'SHIRTS']))->assertCreated()->json('data');
        $this->patchJson("/api/v1/promotions/{$coupon['id']}", ['trigger' => 'automatic'])->assertUnprocessable()->assertJsonValidationErrors('trigger', 'error.details');
        $this->patchJson("/api/v1/promotions/{$coupon['id']}", ['coupon_code' => 'MORE'])->assertUnprocessable();
    }

    public function test_coupon_codes_are_added_generated_changed_and_deleted(): void
    {
        $promotion = $this->postJson('/api/v1/promotions', ['name' => 'Ten off', 'type' => 'fixed', 'value' => '10', 'scope' => 'order', 'trigger' => 'coupon'])->assertCreated()->json('data');
        $auto = $this->postJson('/api/v1/promotions', $this->body())->assertCreated()->json('data');
        $url = "/api/v1/promotions/{$promotion['id']}/coupons";

        $added = $this->postJson($url, ['code' => ' ten-off ', 'usage_limit' => 100])->assertCreated()->json('data');
        $this->assertSame([['code' => 'TEN-OFF', 'usage_limit' => 100, 'used_count' => 0, 'is_active' => true]], array_map(fn ($c) => array_intersect_key($c, array_flip(['code', 'usage_limit', 'used_count', 'is_active'])), $added));
        $this->postJson($url, ['code' => 'Ten-Off'])->assertUnprocessable()->assertJsonValidationErrors('code', 'error.details');
        $this->postJson($url, ['code' => 'no spaces'])->assertUnprocessable()->assertJsonValidationErrors('code', 'error.details');
        $this->postJson($url, ['code' => 'X1', 'generate' => 2])->assertUnprocessable();
        $this->postJson($url, ['generate' => 501])->assertUnprocessable()->assertJsonValidationErrors('generate', 'error.details');
        $this->postJson("/api/v1/promotions/{$auto['id']}/coupons", ['code' => 'AUTO'])->assertStatus(422)->assertJsonPath('error.code', 'NOT_A_COUPON_PROMOTION');

        $generated = $this->postJson($url, ['generate' => 25, 'prefix' => 'eid-'])->assertCreated()->json('data');
        $this->assertCount(25, $generated);
        $codes = array_column($generated, 'code');
        $this->assertCount(25, array_unique($codes));
        foreach ($codes as $code) {
            $this->assertMatchesRegularExpression('/^EID-[A-Z0-9]{8}$/', $code);
        }

        $list = $this->getJson($url)->assertOk();
        $this->assertSame(26, $list->json('meta.pagination.total'));
        $this->assertSame('TEN-OFF', $list->json('data.25.code') ?? $this->getJson($url.'?page=2')->json('data.0.code'));
        $this->assertSame(['TEN-OFF'], array_column($this->getJson($url.'?search=ten')->json('data'), 'code'));
        $this->assertCount(20, $this->getJson("/api/v1/promotions/{$promotion['id']}")->json('data.coupons_preview'));

        $id = $added[0]['id'];
        $this->patchJson("/api/v1/coupons/{$id}", ['is_active' => false, 'usage_limit' => null])->assertOk()
            ->assertJsonPath('data.is_active', false)->assertJsonPath('data.usage_limit', null);
        $this->deleteJson('/api/v1/coupons/'.$generated[0]['id'])->assertNoContent();
        $this->assertSame(25, $this->getJson($url)->json('meta.pagination.total'));
    }

    public function test_used_promotions_and_codes_cannot_be_deleted_and_list_their_redemptions(): void
    {
        $promotion = $this->postJson('/api/v1/promotions', ['name' => 'Ten off', 'type' => 'fixed', 'value' => '10', 'scope' => 'order', 'trigger' => 'coupon', 'coupon_code' => 'TEN'])->assertCreated()->json('data');
        $couponId = $this->getJson("/api/v1/promotions/{$promotion['id']}/coupons")->json('data.0.id');

        $this->asVisitor();
        $this->addToCart('SHIRT', 1);
        $this->browse('POST', $this->storeUrl('cart/coupon'), ['code' => 'ten'])->assertOk();
        $this->placeOrder($this->checkoutBody('500.00'))->assertCreated();

        $this->actingAsUser($this->tenant['admin']);
        $this->deleteJson("/api/v1/promotions/{$promotion['id']}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/coupons/{$couponId}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');

        $row = $this->getJson("/api/v1/promotions/{$promotion['id']}")->json('data');
        $this->assertSame([1, '10.00', 1], [$row['redemption_count'], $row['discount_total'], $row['coupon_count']]);
        $this->assertSame(1, $this->getJson("/api/v1/promotions/{$promotion['id']}/coupons")->json('data.0.used_count'));

        $redemptions = $this->getJson("/api/v1/promotions/{$promotion['id']}/redemptions")->assertOk();
        $this->assertSame(1, $redemptions->json('meta.pagination.total'));
        $this->assertSame(['WEB-000001', null, 'rina@example.test', 'order', '10.00', 'TEN'], [
            $redemptions->json('data.0.order_number'), $redemptions->json('data.0.customer'), $redemptions->json('data.0.email'),
            $redemptions->json('data.0.kind'), $redemptions->json('data.0.amount'), $redemptions->json('data.0.coupon_code'),
        ]);

        // Deactivating instead.
        $this->patchJson("/api/v1/promotions/{$promotion['id']}", ['is_active' => false])->assertOk()->assertJsonPath('data.state', 'inactive');
    }

    public function test_permissions_and_tenant_isolation(): void
    {
        $promotion = $this->postJson('/api/v1/promotions', $this->body())->assertCreated()->json('data');

        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/promotions')->assertOk();
        $this->patchJson("/api/v1/promotions/{$promotion['id']}", ['name' => 'By manager'])->assertOk();

        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/promotions')->assertForbidden();
        $this->postJson('/api/v1/promotions', $this->body())->assertForbidden();

        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $this->assertSame([], $this->getJson('/api/v1/promotions')->assertOk()->json('data'));
        $this->getJson("/api/v1/promotions/{$promotion['id']}")->assertNotFound();
        $this->patchJson("/api/v1/promotions/{$promotion['id']}", ['name' => 'Hijack'])->assertNotFound();
        $this->getJson("/api/v1/promotions/{$promotion['id']}/coupons")->assertNotFound();
        // Org A's product is not a valid target for org B.
        $this->postJson('/api/v1/promotions', $this->body())->assertUnprocessable()->assertJsonValidationErrors('target_ids', 'error.details');
    }
}
