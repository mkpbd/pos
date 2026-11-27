<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Application\Actions\TransferStock;
use App\Modules\Inventory\Application\Contracts\SerialRegister;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\SerialNumber;
use App\Modules\Inventory\Infrastructure\Models\SerialNumberEvent;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

/**
 * ST2d §2: the serial-number register (contract transitions and errors, the legacy rule) and
 * its Inventory callers and API.
 */
class SerialRegisterTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    /**
     * @template T
     *
     * @param  callable(SerialRegister): T  $callback
     * @return T
     */
    private function register(Organization $org, callable $callback): mixed
    {
        return $this->inTenant($org, fn () => DB::transaction(fn () => $callback(app(SerialRegister::class))));
    }

    private function ref(string $number = 'DOC-1'): StockReference
    {
        return new StockReference('test', (string) Str::uuid7(), $number);
    }

    private function refused(callable $call, string $code): BusinessRuleViolation
    {
        try {
            $call();
        } catch (BusinessRuleViolation $e) {
            $this->assertSame($code, $e->errorCode);

            return $e;
        }
        $this->fail("Expected {$code}.");
    }

    private function serial(string $variantId, string $serial): SerialNumber
    {
        return SerialNumber::query()->withoutGlobalScopes()->where('variant_id', $variantId)->whereRaw('lower(serial) = ?', [mb_strtolower($serial)])->firstOrFail();
    }

    /**
     * Stock posted straight to the ledger, as before the register existed.
     */
    private function legacyStock(Organization $org, string $storeId, string $variantId, string $quantity): void
    {
        $this->inTenant($org, fn () => DB::transaction(fn () => app(StockLedger::class)->post(
            [new StockChange($storeId, $variantId, null, MovementType::Opening, $quantity, '100')], $this->ref(),
        )));
    }

    public function test_every_transition_and_its_errors(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $main = $this->mainStoreId($org);
        $northStore = $north->stores()->firstOrFail()->id;

        // receive: new serials come in stock, trimmed; again (any case) is refused.
        $this->register($org, fn (SerialRegister $r) => $r->receive($main, $phone->id, [' IMEI-1 ', 'imei-2'], $this->ref('GRN-1')));
        $this->assertSame(['IMEI-1', 'imei-2'], $this->register($org, fn (SerialRegister $r) => $r->inStock($main, $phone->id)));
        $e = $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->receive($northStore, $phone->id, ['Imei-2', 'IMEI-3'], $this->ref())), 'SERIAL_IN_STOCK');
        $this->assertSame(['imei-2'], $e->details['serials']);
        $this->assertSame(422, $e->status);
        $this->assertSame(0, SerialNumber::query()->withoutGlobalScopes()->whereRaw("lower(serial) = 'imei-3'")->count()); // rolled back

        // issue: only from the store holding it, only while in stock.
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->issue($northStore, $phone->id, ['IMEI-1'], SerialStatus::Sold, $this->ref())), 'SERIAL_NOT_IN_STOCK');
        $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['imei-1'], SerialStatus::Sold, $this->ref('SALE-1')));
        $sold = $this->serial($phone->id, 'IMEI-1');
        $this->assertSame([SerialStatus::Sold, null], [$sold->status, $sold->store_id]);
        $e = $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['IMEI-1'], SerialStatus::Sold, $this->ref())), 'SERIAL_NOT_IN_STOCK');
        $this->assertSame(['IMEI-1'], $e->details['serials']);

        // returnFromCustomer: sold → in stock (at the store it comes back to); then sold again.
        $this->register($org, fn (SerialRegister $r) => $r->returnFromCustomer($northStore, $phone->id, ['IMEI-1'], $this->ref('RET-1')));
        $this->assertSame([SerialStatus::InStock, $northStore], [$this->serial($phone->id, 'IMEI-1')->status, $this->serial($phone->id, 'IMEI-1')->store_id]);
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->returnFromCustomer($main, $phone->id, ['IMEI-1'], $this->ref())), 'SERIAL_IN_STOCK');
        $this->register($org, fn (SerialRegister $r) => $r->issue($northStore, $phone->id, ['IMEI-1'], SerialStatus::Sold, $this->ref('SALE-2')));

        // returned_to_supplier / written_off serials can be received again.
        $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['IMEI-2'], SerialStatus::ReturnedToSupplier, $this->ref('PR-1')));
        $this->register($org, fn (SerialRegister $r) => $r->receive($main, $phone->id, ['IMEI-2'], $this->ref('GRN-2')));
        $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['IMEI-2'], SerialStatus::WrittenOff, $this->ref('ADJ-1')));
        $this->register($org, fn (SerialRegister $r) => $r->receive($main, $phone->id, ['IMEI-2'], $this->ref('ADJ-2'), 'adjusted_in'));
        $this->assertSame(SerialStatus::InStock, $this->serial($phone->id, 'IMEI-2')->status);

        // dispatch → in transit (kept at the source, not in stock); arrive → in stock at the destination.
        $this->register($org, fn (SerialRegister $r) => $r->dispatch($main, $phone->id, ['IMEI-2'], $this->ref('TRF-1')));
        $this->assertSame([SerialStatus::InTransit, $main], [$this->serial($phone->id, 'IMEI-2')->status, $this->serial($phone->id, 'IMEI-2')->store_id]);
        $this->assertSame([], $this->register($org, fn (SerialRegister $r) => $r->inStock($main, $phone->id)));
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['IMEI-2'], SerialStatus::Sold, $this->ref())), 'SERIAL_NOT_IN_STOCK');
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->receive($main, $phone->id, ['IMEI-2'], $this->ref())), 'SERIAL_IN_STOCK');
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->arrive($northStore, $phone->id, ['IMEI-1'], $this->ref())), 'SERIAL_NOT_IN_STOCK');
        $this->register($org, fn (SerialRegister $r) => $r->arrive($northStore, $phone->id, ['IMEI-2'], $this->ref('TRF-1')));
        $this->assertSame(['imei-2'], $this->register($org, fn (SerialRegister $r) => $r->inStock($northStore, $phone->id))); // as first entered

        // The history: one event per change, with its document.
        $events = SerialNumberEvent::query()->withoutGlobalScopes()->where('serial_number_id', $this->serial($phone->id, 'IMEI-2')->id)->orderBy('created_at')->orderBy('id')->get();
        $this->assertSame(['received', 'returned_to_supplier', 'received', 'written_off', 'adjusted_in', 'transferred_out', 'transferred_in'], $events->pluck('type')->all());
        $this->assertSame(['GRN-1', 'PR-1', 'GRN-2', 'ADJ-1', 'ADJ-2', 'TRF-1', 'TRF-1'], $events->pluck('reference_number')->all());
        $this->assertSame($northStore, $events->last()->store_id);
    }

    public function test_a_serial_entered_twice_is_refused(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $main = $this->mainStoreId($org);

        try {
            $this->register($org, fn (SerialRegister $r) => $r->receive($main, $phone->id, ['A-1', 'a-1 '], $this->ref()));
            $this->fail('A serial entered twice should be refused.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('serials', $e->errors());
        }
    }

    public function test_unknown_serials_sell_only_from_unregistered_stock(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $main = $this->mainStoreId($org);
        $this->legacyStock($org, $main, $phone->id, '2');                   // 2 units from before the register
        $this->register($org, fn (SerialRegister $r) => $r->receive($main, $phone->id, ['NEW-1'], $this->ref()));
        $this->legacyStock($org, $main, $phone->id, '1');                   // + the registered unit: 3 on hand, 2 unregistered

        $e = $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['OLD-1', 'OLD-2', 'OLD-3'], SerialStatus::Sold, $this->ref())), 'SERIAL_NOT_IN_STOCK');
        $this->assertSame(['OLD-1', 'OLD-2', 'OLD-3'], $e->details['serials']);

        $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['OLD-1', 'NEW-1'], SerialStatus::Sold, $this->ref()));
        $this->assertSame([SerialStatus::Sold, null], [$this->serial($phone->id, 'old-1')->status, $this->serial($phone->id, 'old-1')->store_id]);
        $this->assertSame(1, SerialNumberEvent::query()->withoutGlobalScopes()->where('serial_number_id', $this->serial($phone->id, 'OLD-1')->id)->where('type', 'sold')->count());
        // The units leave the stock; one unregistered unit is left (on hand 1, registered 0).
        $this->inTenant($org, fn () => DB::transaction(fn () => app(StockLedger::class)->post([new StockChange($main, $phone->id, null, MovementType::Sale, '2')], $this->ref())));
        $this->register($org, fn (SerialRegister $r) => $r->dispatch($main, $phone->id, ['OLD-2'], $this->ref()));
        $this->assertSame(SerialStatus::InTransit, $this->serial($phone->id, 'OLD-2')->status);
        $this->inTenant($org, fn () => DB::transaction(fn () => app(StockLedger::class)->post([new StockChange($main, $phone->id, null, MovementType::TransferOut, '1')], $this->ref())));
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['OLD-3'], SerialStatus::Sold, $this->ref())), 'SERIAL_NOT_IN_STOCK');
        // A sold serial is never "unknown": it cannot be sold again from legacy stock.
        $this->legacyStock($org, $main, $phone->id, '5');
        $this->refused(fn () => $this->register($org, fn (SerialRegister $r) => $r->issue($main, $phone->id, ['OLD-1'], SerialStatus::Sold, $this->ref())), 'SERIAL_NOT_IN_STOCK');
        // An unknown serial coming back from a customer is created in stock.
        $this->register($org, fn (SerialRegister $r) => $r->returnFromCustomer($main, $phone->id, ['OLD-9'], $this->ref()));
        $this->assertSame(SerialStatus::InStock, $this->serial($phone->id, 'OLD-9')->status);
    }

    public function test_stock_adjustments_receive_and_write_off_serials(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $juice = $this->stockedVariant($org);
        $main = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '100'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '100', 'serials' => ['S-1']], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '100', 'serials' => ['S-1', 's-1']], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $this->adjust($main, 'opening', ['variant_id' => $juice->id, 'quantity' => '2', 'serials' => ['J-1', 'J-2']], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);

        $adjustment = $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '100', 'serials' => ['S-1', 'S-2']])->json('data');
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['S-1', 'S-2']);
        $event = SerialNumberEvent::query()->where('serial_number_id', $this->serial($phone->id, 'S-1')->id)->sole();
        $this->assertSame(['adjusted_in', 'stock_adjustment', $adjustment['id'], $adjustment['number'], $admin->id], [$event->type, $event->reference_type, $event->reference_id, $event->reference_number, $event->created_by]);

        // Already in stock: refused, and nothing posted.
        $this->adjust($main, 'correction', ['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '100', 'serials' => ['s-2']], 422)
            ->assertJsonPath('error.code', 'SERIAL_IN_STOCK')->assertJsonPath('error.details.serials', ['S-2']);
        $this->assertSame('2.000', $this->stockRow($phone->id, $main)['quantity']);

        // A decrease writes the serials off; one not in stock is refused.
        $this->adjust($main, 'damage', ['variant_id' => $phone->id, 'quantity' => '-1', 'serials' => ['S-9']], 422)
            ->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK')->assertJsonPath('error.details.serials', ['S-9']);
        $this->adjust($main, 'damage', ['variant_id' => $phone->id, 'quantity' => '-1', 'serials' => ['S-1']]);
        $this->assertSame(SerialStatus::WrittenOff, $this->serial($phone->id, 'S-1')->status);
        $this->assertSame('1.000', $this->stockRow($phone->id, $main)['quantity']);

        // A stock count (like a stocktake) moves the quantity only: no serials asked, the register is unchanged.
        $this->adjust($main, 'count', ['variant_id' => $phone->id, 'counted_quantity' => '3']);
        $this->assertSame('3.000', $this->stockRow($phone->id, $main)['quantity']);
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['S-2']);
    }

    public function test_transfers_move_serials_and_a_cancel_brings_them_back(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $main = $this->mainStoreId($org);
        $northStore = $north->stores()->firstOrFail()->id;
        $this->actingAsUser($admin);
        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '3', 'unit_cost' => '100', 'serials' => ['T-1', 'T-2', 'T-3']]);
        $send = fn (array $line, int $status = 201) => $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $main, 'to_store_id' => $northStore, 'lines' => [$line]])->assertStatus($status);

        $send(['variant_id' => $phone->id, 'quantity' => '2'], 422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $send(['variant_id' => $phone->id, 'quantity' => '1', 'serials' => ['T-9']], 422)->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK');
        $transfer = $send(['variant_id' => $phone->id, 'quantity' => '2', 'serials' => ['t-1', 'T-2']])->json('data');
        $this->assertSame(SerialStatus::InTransit, $this->serial($phone->id, 'T-1')->status);
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['T-3']);

        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/cancel")->assertOk();
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['T-1', 'T-2', 'T-3']);
        $this->assertSame('3.000', $this->stockRow($phone->id, $main)['quantity']);

        // A request is dispatched with its serials (the serial line must be listed) and received.
        $request = $this->postJson('/api/v1/inventory/transfers/requests', [
            'from_store_id' => $main, 'to_store_id' => $northStore, 'lines' => [['variant_id' => $phone->id, 'quantity' => '1']],
        ])->assertCreated()->json('data');
        $this->postJson("/api/v1/inventory/transfers/{$request['id']}/dispatch")->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $this->postJson("/api/v1/inventory/transfers/{$request['id']}/dispatch", ['lines' => [['line_id' => $request['lines'][0]['id'], 'quantity' => '1', 'serials' => ['T-3']]]])->assertOk();
        $this->assertSame(SerialStatus::InTransit, $this->serial($phone->id, 'T-3')->status);
        $this->postJson("/api/v1/inventory/transfers/{$request['id']}/receive")->assertOk();
        $this->getJson("/api/v1/inventory/stores/{$northStore}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['T-3']);
        $types = SerialNumberEvent::query()->where('serial_number_id', $this->serial($phone->id, 'T-3')->id)->orderBy('created_at')->orderBy('id')->pluck('type')->all();
        $this->assertSame(['adjusted_in', 'transferred_out', 'transferred_in'], $types);
        $this->getJson("/api/v1/inventory/transfers/{$request['id']}")->assertJsonPath('data.lines.0.serials', ['T-3']);

        // A system replenishment transfer moves quantities only (no serials asked).
        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '100', 'serials' => ['T-4']]);
        $reorder = $this->inTenant($org, fn () => app(TransferStock::class)->dispatch($admin, [
            'from_store_id' => $main, 'to_store_id' => $northStore, 'lines' => [['variant_id' => $phone->id, 'quantity' => '1']],
        ], allocateBatches: true));
        $this->assertSame('in_transit', $reorder->status->value);
    }

    public function test_a_stocktake_variance_on_a_serial_numbered_product_posts_without_serials(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $main = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '100', 'serials' => ['K-1', 'K-2']]);

        $result = $this->inTenant($org, fn () => app(PostStockAdjustment::class)->postCount($admin, $main, [
            ['variant_id' => $phone->id, 'batch_id' => null, 'counted_quantity' => '5', 'system_quantity' => null],
        ]));
        $this->assertNotNull($result['adjustment']);
        $this->assertSame('5.000', $this->stockRow($phone->id, $main)['quantity']);
        // The register is untouched; the 3 extra units are unregistered (the legacy rule sells them).
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['K-1', 'K-2']);
    }

    public function test_the_serial_api_lists_details_and_scopes_by_branch_and_tenant(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $main = $this->mainStoreId($org);
        $northStore = $north->stores()->firstOrFail()->id;
        $this->actingAsUser($admin);
        $this->adjust($main, 'opening', ['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '100', 'serials' => ['M-1', 'M-2']]);
        $this->adjust($northStore, 'opening', ['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '100', 'serials' => ['N-1']]);
        $this->adjust($main, 'damage', ['variant_id' => $phone->id, 'quantity' => '-1', 'serials' => ['M-2']]);

        $this->getJson('/api/v1/inventory/serials')->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('meta.pagination.total', 3);
        $this->getJson('/api/v1/inventory/serials?search=m-')->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/inventory/serials?search=phone')->assertJsonCount(3, 'data');
        $this->getJson('/api/v1/inventory/serials?status=written_off')->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.serial', 'M-2')->assertJsonPath('data.0.store', null)->assertJsonPath('data.0.variant.product_name', 'Phone');
        $row = $this->getJson("/api/v1/inventory/serials?store_id={$northStore}&variant_id={$phone->id}")->assertJsonCount(1, 'data')->json('data.0');
        $this->assertSame(['N-1', 'in_stock', $northStore], [$row['serial'], $row['status'], $row['store']['id']]);
        $this->getJson('/api/v1/inventory/serials?status=lost')->assertStatus(422);

        $id = $this->serial($phone->id, 'M-2')->id;
        $detail = $this->getJson("/api/v1/inventory/serials/{$id}")->assertOk()->assertJsonPath('data.status', 'written_off')->json('data.events');
        $this->assertSame(['written_off', 'adjusted_in'], array_column($detail, 'type'));
        $this->assertSame('stock_adjustment', $detail[0]['reference_type']);
        $this->assertStringStartsWith('ADJ-', $detail[0]['reference_number']);
        $this->assertSame($admin->name, $detail[0]['created_by']['name']);
        $this->assertSame($main, $detail[0]['store']['id']);

        // A NORTH clerk sees NORTH's serials and those that left the business, not MAIN's stock.
        $clerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($clerk);
        $this->assertEqualsCanonicalizing(['N-1', 'M-2'], array_column($this->getJson('/api/v1/inventory/serials')->json('data'), 'serial'));
        $this->getJson('/api/v1/inventory/serials/'.$this->serial($phone->id, 'M-1')->id)->assertNotFound();
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertNotFound();
        $this->getJson("/api/v1/inventory/stores/{$northStore}/serials?variant_id={$phone->id}")->assertJsonPath('data.*.serial', ['N-1']);
        $this->getJson("/api/v1/inventory/stores/{$northStore}/serials")->assertStatus(422);

        // Another organization sees nothing; a cashier without inventory.view is forbidden.
        ['admin' => $rival, 'organization' => $rivalOrg] = $this->provisionTenant('Rival');
        $this->actingAsUser($rival);
        $this->getJson('/api/v1/inventory/serials')->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/inventory/serials/{$id}")->assertNotFound();
        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phone->id}")->assertNotFound();
        $this->actingAsUser($this->createUserWithRole($rivalOrg, SystemRole::Cashier));
        $this->getJson('/api/v1/inventory/serials')->assertForbidden();
    }
}
