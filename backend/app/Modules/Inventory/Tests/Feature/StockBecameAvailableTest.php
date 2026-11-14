<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Application\Events\StockBecameAvailable;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

/**
 * P1a: the ledger announces variants whose store quantity goes from none (or less) to some.
 */
class StockBecameAvailableTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_only_crossings_from_none_to_some_are_announced(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $a = $this->stockedVariant($org, 'A');
        $b = $this->stockedVariant($org, 'B');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        Event::fake([StockBecameAvailable::class]);

        $post = fn (string $reason, array $lines) => $this->postJson('/api/v1/inventory/adjustments', ['store_id' => $store, 'reason' => $reason, 'lines' => $lines])->assertCreated();
        $post('opening', [['variant_id' => $a->id, 'quantity' => '2', 'unit_cost' => '1'], ['variant_id' => $b->id, 'quantity' => '1', 'unit_cost' => '1']]);
        Event::assertDispatchedTimes(StockBecameAvailable::class, 1);
        Event::assertDispatched(StockBecameAvailable::class, fn (StockBecameAvailable $e) => $e->storeId === $store && $e->organizationId === $org->id
            && collect($e->variantIds)->sort()->values()->all() === collect([$a->id, $b->id])->sort()->values()->all());

        // More stock (2 → 5) and less stock (1 → 0) are not crossings.
        $post('correction', [['variant_id' => $a->id, 'quantity' => '3', 'unit_cost' => '1'], ['variant_id' => $b->id, 'quantity' => '-1']]);
        Event::assertDispatchedTimes(StockBecameAvailable::class, 1);

        // Back from zero: B only.
        $this->adjust($store, 'correction', ['variant_id' => $b->id, 'quantity' => '4', 'unit_cost' => '1']);
        Event::assertDispatchedTimes(StockBecameAvailable::class, 2);
        Event::assertDispatched(StockBecameAvailable::class, fn (StockBecameAvailable $e) => $e->variantIds === [$b->id]);
    }
}
