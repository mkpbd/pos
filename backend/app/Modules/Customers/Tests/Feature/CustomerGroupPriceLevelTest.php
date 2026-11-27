<?php

namespace App\Modules\Customers\Tests\Feature;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ST2c: a customer group's price level (retail | wholesale) on the group API, the customer
 * detail / search and the CustomerDirectory used by the till.
 */
class CustomerGroupPriceLevelTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_group_price_level_is_saved_audited_and_carried_by_customers(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($admin);

        $retail = $this->postJson('/api/v1/customer-groups', ['name' => 'Regulars'])
            ->assertCreated()->assertJsonPath('data.price_level', 'retail')->json('data.id');
        $group = $this->postJson('/api/v1/customer-groups', ['name' => 'Traders', 'price_level' => 'wholesale'])
            ->assertCreated()->assertJsonPath('data.price_level', 'wholesale')->json('data.id');
        $this->postJson('/api/v1/customer-groups', ['name' => 'Odd', 'price_level' => 'vip'])
            ->assertUnprocessable()->assertJsonValidationErrors(['price_level'], 'error.details');

        $this->patchJson("/api/v1/customer-groups/{$retail}", ['price_level' => 'wholesale'])->assertOk()->assertJsonPath('data.price_level', 'wholesale');
        $audit = $this->getJson('/api/v1/audit-logs?action=customer_group.updated')->assertOk()->json('data.0');
        $this->assertSame(['price_level' => 'retail'], $audit['old_values']);
        $this->assertSame(['price_level' => 'wholesale'], $audit['new_values']);
        $this->patchJson("/api/v1/customer-groups/{$retail}", ['price_level' => 'retail'])->assertOk();

        $list = collect($this->getJson('/api/v1/customer-groups')->assertOk()->json('data'))->pluck('price_level', 'name')->all();
        $this->assertSame(['Regulars' => 'retail', 'Traders' => 'wholesale'], $list);

        $trader = $this->postJson('/api/v1/customers', ['name' => 'Rahman Traders', 'customer_group_id' => $group])
            ->assertCreated()->assertJsonPath('data.group.price_level', 'wholesale')->json('data.id');
        $walkIn = $this->postJson('/api/v1/customers', ['name' => 'Walk In'])->assertCreated()->json('data.id');
        $this->getJson("/api/v1/customers/{$trader}")->assertOk()->assertJsonPath('data.group.price_level', 'wholesale');
        $this->getJson('/api/v1/customers?search=Rahman')->assertOk()->assertJsonPath('data.0.group.price_level', 'wholesale');

        $directory = app(CustomerDirectory::class);
        $this->assertSame('wholesale', $directory->find($trader, $org->id)['price_level']);
        $this->assertSame('retail', $directory->find($walkIn, $org->id)['price_level']);
        $this->assertNull($directory->find($trader, $other['organization']->id));

        // Another organization cannot change the group.
        $this->actingAsUser($other['admin']);
        $this->patchJson("/api/v1/customer-groups/{$group}", ['price_level' => 'retail'])->assertNotFound();
    }
}
