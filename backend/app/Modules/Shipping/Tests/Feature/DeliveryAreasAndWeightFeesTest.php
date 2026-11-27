<?php

namespace App\Modules\Shipping\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Shipping\Domain\ShippingFee;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * BD2a: delivery areas inside a district (fee adjustment), weight pricing of delivery methods
 * and the one fee rule behind ShippingRates.
 */
class DeliveryAreasAndWeightFeesTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const DHAKA = 18;

    private int $other;

    /** @var array{organization: Organization, admin: User, branch: mixed} */
    private array $tenant;

    private string $zone;

    private string $method;

    protected function setUp(): void
    {
        parent::setUp();
        $this->other = (int) DB::table('geo_districts')->where('id', '!=', self::DHAKA)->orderBy('id')->value('id');
        $this->tenant = $this->provisionTenant();
        $this->actingAsUser($this->tenant['admin']);
        $this->zone = $this->postJson('/api/v1/shipping/zones', ['name' => 'Dhaka', 'district_ids' => [self::DHAKA, $this->other]])->assertCreated()->json('data.id');
        $this->method = $this->postJson("/api/v1/shipping/zones/{$this->zone}/methods", [
            'name' => 'Home delivery', 'fee' => '60', 'free_over' => '2000', 'eta_min_days' => 1, 'eta_max_days' => 2,
            'weight_included_kg' => '1', 'fee_per_extra_kg' => '15',
        ])->assertCreated()->assertJsonPath('data.weight_included_kg', '1.000')->assertJsonPath('data.fee_per_extra_kg', '15.00')->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function area(array $body): string
    {
        return $this->postJson('/api/v1/shipping/areas', $body + ['district_id' => self::DHAKA])->assertCreated()->json('data.id');
    }

    /**
     * @return array<string, mixed>
     */
    private function priced(?string $areaId, int $grams, int $district = self::DHAKA): array
    {
        return $this->inTenant($this->tenant['organization'], fn () => app(ShippingRates::class)->methodForDistrict($this->method, $district, $areaId, $grams));
    }

    public function test_areas_are_managed_validated_and_audited(): void
    {
        $gulshan = $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => ' Gulshan ', 'fee_adjustment' => '20', 'sort_order' => 2])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Gulshan')
            ->assertJsonPath('data.fee_adjustment', '20.00')
            ->assertJsonPath('data.is_active', true)
            ->json('data');
        $this->area(['name' => 'Mirpur', 'fee_adjustment' => '-10.5', 'sort_order' => 1]);
        $this->area(['name' => 'Sadar', 'district_id' => $this->other]);

        // Names are unique per district, ignoring case; the same name is fine in another district.
        $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => 'GULSHAN'])->assertStatus(422)->assertJsonValidationErrors('name', 'error.details');
        $this->area(['name' => 'Gulshan', 'district_id' => $this->other]);
        $this->postJson('/api/v1/shipping/areas', ['district_id' => 9999, 'name' => 'X', 'fee_adjustment' => '1.234'])->assertStatus(422)
            ->assertJsonValidationErrors(['district_id', 'fee_adjustment'], 'error.details');
        $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => '   '])->assertStatus(422)->assertJsonValidationErrors('name', 'error.details');

        $this->getJson('/api/v1/shipping/areas?district_id='.self::DHAKA)->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.name', 'Mirpur')
            ->assertJsonPath('data.0.fee_adjustment', '-10.50')
            ->assertJsonPath('data.1.name', 'Gulshan');
        $this->getJson('/api/v1/shipping/areas')->assertOk()->assertJsonCount(4, 'data');

        $this->patchJson("/api/v1/shipping/areas/{$gulshan['id']}", ['name' => 'mirpur'])->assertStatus(422)->assertJsonValidationErrors('name', 'error.details');
        $this->patchJson("/api/v1/shipping/areas/{$gulshan['id']}", ['fee_adjustment' => '25', 'is_active' => false])->assertOk()
            ->assertJsonPath('data.fee_adjustment', '25.00')
            ->assertJsonPath('data.is_active', false)
            ->assertJsonPath('data.name', 'Gulshan');
        $this->deleteJson("/api/v1/shipping/areas/{$gulshan['id']}")->assertNoContent();
        $this->getJson('/api/v1/shipping/areas?district_id='.self::DHAKA)->assertJsonCount(1, 'data');

        $actions = AuditLog::query()->withoutGlobalScopes()->where('action', 'like', 'shipping.area_%')->pluck('action')->all();
        $this->assertSame(4, count(array_filter($actions, fn ($a) => $a === 'shipping.area_created')));
        $this->assertContains('shipping.area_updated', $actions);
        $this->assertContains('shipping.area_deleted', $actions);
        $updated = AuditLog::query()->withoutGlobalScopes()->where('action', 'shipping.area_updated')->sole();
        $this->assertSame('20.00', $updated->old_values['fee_adjustment']);
        $this->assertSame('25.00', $updated->new_values['fee_adjustment']);
    }

    public function test_area_permissions(): void
    {
        $areaId = $this->area(['name' => 'Gulshan']);
        $org = $this->tenant['organization'];

        // Reading also with web_orders.view (staff orders pick an area); changes need shipping.manage.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Accountant));
        $this->getJson('/api/v1/shipping/areas')->assertOk()->assertJsonCount(1, 'data');
        $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => 'X'])->assertForbidden();
        $this->patchJson("/api/v1/shipping/areas/{$areaId}", ['name' => 'X'])->assertForbidden();
        $this->deleteJson("/api/v1/shipping/areas/{$areaId}")->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier));
        $this->getJson('/api/v1/shipping/areas')->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => 'Banani'])->assertCreated();
    }

    public function test_method_weight_pricing_fields(): void
    {
        $this->getJson('/api/v1/shipping/zones')->assertOk()
            ->assertJsonPath('data.0.methods.0.weight_included_kg', '1.000')
            ->assertJsonPath('data.0.methods.0.fee_per_extra_kg', '15.00');
        $this->patchJson("/api/v1/shipping/methods/{$this->method}", ['weight_included_kg' => '2.5'])->assertOk()
            ->assertJsonPath('data.weight_included_kg', '2.500')
            ->assertJsonPath('data.fee_per_extra_kg', '15.00');
        $this->patchJson("/api/v1/shipping/methods/{$this->method}", ['weight_included_kg' => null, 'fee_per_extra_kg' => null])->assertOk()
            ->assertJsonPath('data.weight_included_kg', null)
            ->assertJsonPath('data.fee_per_extra_kg', '0.00');
        $this->patchJson("/api/v1/shipping/methods/{$this->method}", ['weight_included_kg' => '-1', 'fee_per_extra_kg' => '-2'])->assertStatus(422)
            ->assertJsonValidationErrors(['weight_included_kg', 'fee_per_extra_kg'], 'error.details');
        // Without weight pricing a heavy parcel costs the base fee.
        $this->assertSame(['60.00', '0.00'], [$this->priced(null, 9000)['fee'], $this->priced(null, 9000)['weight_fee']]);

        $created = AuditLog::query()->withoutGlobalScopes()->where('action', 'shipping.method_created')->sole();
        $this->assertSame('1.000', $created->new_values['weight_included_kg']);

        // A method added without the fields has no weight pricing.
        $this->postJson("/api/v1/shipping/zones/{$this->zone}/methods", ['name' => 'Pickup', 'fee' => '0', 'eta_min_days' => 0, 'eta_max_days' => 0])->assertCreated()
            ->assertJsonPath('data.weight_included_kg', null)
            ->assertJsonPath('data.fee_per_extra_kg', '0.00');
    }

    public function test_fee_adds_the_area_adjustment(): void
    {
        $plus = $this->area(['name' => 'Gulshan', 'fee_adjustment' => '20']);
        $minus = $this->area(['name' => 'Keraniganj', 'fee_adjustment' => '-15.50']);

        $this->assertSame(['fee' => '80.00', 'base_fee' => '60.00', 'area_adjustment' => '20.00', 'weight_fee' => '0.00'],
            array_intersect_key($this->priced($plus, 0), array_flip(['fee', 'base_fee', 'area_adjustment', 'weight_fee'])));
        $this->assertSame(['44.50', '-15.50'], [$this->priced($minus, 0)['fee'], $this->priced($minus, 0)['area_adjustment']]);
        $this->assertSame(['60.00', '0.00'], [$this->priced(null, 0)['fee'], $this->priced(null, 0)['area_adjustment']]);

        // Every method of the district, other option fields unchanged.
        $options = $this->inTenant($this->tenant['organization'], fn () => app(ShippingRates::class)->methodsForDistrict(self::DHAKA, $plus));
        $this->assertSame('80.00', $options[0]['fee']);
        $this->assertSame('2000.00', $options[0]['free_over']);
        $this->assertSame('Home delivery', $options[0]['name']);
    }

    public function test_weight_under_at_and_over_the_included_kg_rounds_up_to_whole_kg(): void
    {
        $this->assertSame(['60.00', '0.00'], [$this->priced(null, 0)['fee'], $this->priced(null, 0)['weight_fee']]);
        $this->assertSame(['60.00', '0.00'], [$this->priced(null, 999)['fee'], $this->priced(null, 999)['weight_fee']]);
        $this->assertSame(['60.00', '0.00'], [$this->priced(null, 1000)['fee'], $this->priced(null, 1000)['weight_fee']]);
        $this->assertSame(['75.00', '15.00'], [$this->priced(null, 1001)['fee'], $this->priced(null, 1001)['weight_fee']]);
        $this->assertSame(['75.00', '15.00'], [$this->priced(null, 2000)['fee'], $this->priced(null, 2000)['weight_fee']]);
        $this->assertSame(['90.00', '30.00'], [$this->priced(null, 2001)['fee'], $this->priced(null, 2001)['weight_fee']]);

        // Fractional included kg: 1501 g over 0.5 kg = 1.001 kg → 2 started kg.
        $this->assertSame(['fee' => '30.00', 'base_fee' => '10.00', 'area_adjustment' => '0.00', 'weight_fee' => '20.00'],
            ShippingFee::forDelivery('10', '0', '0.500', '10', 1501));
        // Zero kg included: every started kg pays.
        $this->assertSame('10.00', ShippingFee::forDelivery('0', '0', '0', '10', 1)['fee']);
        // No weight pricing (null included kg).
        $this->assertSame('10.00', ShippingFee::forDelivery('10', '0', null, '10', 50000)['fee']);
    }

    public function test_area_plus_weight_never_below_zero_and_free_over(): void
    {
        $plus = $this->area(['name' => 'Gulshan', 'fee_adjustment' => '20']);
        $cheap = $this->area(['name' => 'Next door', 'fee_adjustment' => '-100']);

        $this->assertSame(['fee' => '125.00', 'base_fee' => '60.00', 'area_adjustment' => '20.00', 'weight_fee' => '45.00'],
            array_intersect_key($this->priced($plus, 3500), array_flip(['fee', 'base_fee', 'area_adjustment', 'weight_fee'])));
        // 60 − 100 → 0, the breakdown still explains it; weight added back on top stays at the floor until it crosses 0.
        $this->assertSame(['0.00', '-100.00'], [$this->priced($cheap, 0)['fee'], $this->priced($cheap, 0)['area_adjustment']]);
        $this->assertSame('0.00', $this->priced($cheap, 2500)['fee']);
        $this->assertSame('5.00', $this->priced($cheap, 4000)['fee']);

        // free_over is applied by the caller on the priced fee, as before.
        $fee = $this->priced($plus, 3500);
        $this->assertSame('0.00', ShippingFee::delivery($fee['fee'], $fee['free_over'], '2000.00'));
        $this->assertSame('125.00', ShippingFee::delivery($fee['fee'], $fee['free_over'], '1999.99'));
    }

    public function test_unknown_inactive_or_foreign_district_areas_are_ignored_and_areas_lists_active_ones(): void
    {
        $gulshan = $this->area(['name' => 'Gulshan', 'fee_adjustment' => '20', 'sort_order' => 2]);
        $this->area(['name' => 'Mirpur', 'fee_adjustment' => '5', 'sort_order' => 1]);
        $off = $this->area(['name' => 'Closed', 'fee_adjustment' => '50', 'is_active' => false]);
        $sadar = $this->area(['name' => 'Sadar', 'fee_adjustment' => '30', 'district_id' => $this->other]);

        $this->assertSame('60.00', $this->priced((string) Str::uuid(), 0)['fee']);
        $this->assertSame('60.00', $this->priced('not-a-uuid', 0)['fee']);
        $this->assertSame('60.00', $this->priced($off, 0)['fee']);
        $this->assertSame('60.00', $this->priced($sadar, 0)['fee']);
        $this->assertSame('90.00', $this->priced($sadar, 0, $this->other)['fee']);
        $this->assertSame('80.00', $this->priced($gulshan, 0)['fee']);

        $areas = $this->inTenant($this->tenant['organization'], fn () => app(ShippingRates::class)->areas(self::DHAKA));
        $this->assertSame([['name' => 'Mirpur', 'fee_adjustment' => '5.00'], ['name' => 'Gulshan', 'fee_adjustment' => '20.00']],
            array_map(fn (array $a) => ['name' => $a['name'], 'fee_adjustment' => $a['fee_adjustment']], $areas));
        $this->assertSame($gulshan, $areas[1]['id']);
        $this->assertSame([], $this->inTenant($this->tenant['organization'], fn () => app(ShippingRates::class)->areas(self::DHAKA + 1)));

        // District lists and the zone overview show base fees.
        $methods = $this->inTenant($this->tenant['organization'], fn () => app(ShippingRates::class)->districtMethods())['methods'];
        $this->assertSame('60.00', $methods[0]['fee']);
        $this->assertArrayNotHasKey('area_adjustment', $methods[0]);
    }

    public function test_areas_are_isolated_between_organizations(): void
    {
        $gulshan = $this->area(['name' => 'Gulshan', 'fee_adjustment' => '20']);
        $other = $this->provisionTenant('Other Shop');

        $this->actingAsUser($other['admin']);
        $this->getJson('/api/v1/shipping/areas')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/v1/shipping/areas/{$gulshan}", ['name' => 'Mine'])->assertNotFound();
        $this->deleteJson("/api/v1/shipping/areas/{$gulshan}")->assertNotFound();
        // The same name is free in another organization.
        $this->postJson('/api/v1/shipping/areas', ['district_id' => self::DHAKA, 'name' => 'Gulshan'])->assertCreated();
        $zone = $this->postJson('/api/v1/shipping/zones', ['name' => 'Dhaka', 'district_ids' => [self::DHAKA]])->assertCreated()->json('data.id');
        $method = $this->postJson("/api/v1/shipping/zones/{$zone}/methods", ['name' => 'Courier', 'fee' => '100', 'eta_min_days' => 1, 'eta_max_days' => 2])->assertCreated()->json('data.id');

        // Another organization's area adds nothing and is not listed.
        $rates = $this->inTenant($other['organization'], fn () => [
            app(ShippingRates::class)->methodForDistrict($method, self::DHAKA, $gulshan),
            app(ShippingRates::class)->areas(self::DHAKA),
        ]);
        $this->assertSame('100.00', $rates[0]['fee']);
        $this->assertSame(['Gulshan'], array_column($rates[1], 'name'));
        $this->assertNotSame($gulshan, $rates[1][0]['id']);
        $this->assertSame('Gulshan', DB::table('shipping_areas')->where('id', $gulshan)->value('name'));
    }
}
