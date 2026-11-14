<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Payments\Application\Actions\OpenRegisterSession;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Sales\Application\Actions\CompleteSale;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P1b: "frequently bought together" — co-purchase scores from web orders and POS sales
 * (`pos:affinities:compute`, nightly per organization), the automatic list on the product page
 * (score ≥ 2, live and in stock, hand-picked products first) and tenant isolation.
 */
class ProductAffinitiesTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private bool $tillOpen = false;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * A cash sale at the shop counter (POS) of these SKUs.
     *
     * @param  array<string, string>  $lines  sku => quantity
     */
    private function counterSale(array $lines): void
    {
        $this->inTenant($this->tenant['organization'], function () use ($lines) {
            $admin = User::query()->findOrFail($this->tenant['admin']->id);
            $store = $this->tenant['store'];
            if (! $this->tillOpen) {
                $till = CashRegister::query()->create(['branch_id' => $store->branch_id, 'code' => 'T1', 'name' => 'Counter']);
                app(OpenRegisterSession::class)($admin, $till, '0.00');
                $this->tillOpen = true;
            }
            app(CompleteSale::class)($admin, [
                'store_id' => $store->id,
                'lines' => array_map(fn (string $sku, string $qty) => ['variant_id' => $this->v[$sku], 'quantity' => $qty], array_keys($lines), $lines),
                'payments' => [['method' => 'cash', 'amount' => '5000.00']],
            ]);
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function related(string $slug, string $host = self::HOST): array
    {
        return $this->getJson("http://{$host}/api/v1/store/products/{$slug}/related")->assertOk()->json('data');
    }

    private function cancel(string $number): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $this->postJson("/api/v1/web-orders/{$this->orderModel($number)->id}/cancel", ['reason' => 'Changed mind'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $this->asVisitor();
    }

    public function test_frequently_bought_together_comes_from_web_orders_and_counter_sales(): void
    {
        $this->assertSame(['related', 'frequently_bought', 'frequently_bought_source'], array_keys($this->related('shirt')));

        // Shirt + Rice in three web orders; Shirt + Juice in one order and one counter sale.
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 2]);
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1, 'JUICE' => 1]);
        $this->counterSale(['SHIRT' => '1', 'JUICE' => '1']);
        // Not counted: a cancelled order and a bank transfer still awaiting payment (Juice + Pills twice).
        $this->cancel($this->customerOrder(['JUICE' => 1, 'PILLS' => 1]));
        $this->customerOrder(['JUICE' => 1, 'PILLS' => 1], 'bank_transfer');

        // Nothing until the job runs.
        $shirt = $this->related('shirt');
        $this->assertSame([[], null], [$shirt['frequently_bought'], $shirt['frequently_bought_source']]);

        $this->artisan('pos:affinities:compute')->assertSuccessful();

        $shirt = $this->related('shirt');
        $this->assertSame(['Rice', 'Juice'], array_column($shirt['frequently_bought'], 'name'), 'Most often bought together first.');
        $this->assertSame('automatic', $shirt['frequently_bought_source']);
        $this->assertSame(['Shirt'], array_column($this->related('rice')['frequently_bought'], 'name'));
        $this->assertSame(['Shirt'], array_column($this->related('juice')['frequently_bought'], 'name'), 'Rice + Juice was bought together once only.');
        $this->assertSame([[], null], [$this->related('pills')['frequently_bought'], $this->related('pills')['frequently_bought_source']]);

        $rows = DB::table('product_affinities')->where('organization_id', $this->tenant['organization']->id)->orderByDesc('score')->get();
        $this->assertSame([3, 3, 2, 2], $rows->pluck('score')->map(fn ($s) => (int) $s)->all());
        $this->assertSame(4, (int) DB::table('product_affinity_runs')->where('organization_id', $this->tenant['organization']->id)->value('pairs'));

        // The last shirt sold at the counter (one product: no pair): out of stock, so it drops out of the others' lists.
        $this->counterSale(['SHIRT' => '1']);
        $juice = $this->related('juice');
        $this->assertSame([[], null], [$juice['frequently_bought'], $juice['frequently_bought_source']]);
        $this->assertSame([], $this->related('rice')['frequently_bought']);
        $this->assertSame(['Rice', 'Juice'], array_column($this->related('shirt')['frequently_bought'], 'name'));
    }

    public function test_hand_picked_products_come_before_the_automatic_ones(): void
    {
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        $this->artisan('pos:affinities:compute', ['--organization' => $this->tenant['organization']->id])->assertSuccessful();
        $this->assertSame(['Rice'], array_column($this->related('shirt')['frequently_bought'], 'name'));

        $this->actingAsUser($this->tenant['admin']);
        $shirtId = $this->getJson($this->storeUrl('products/shirt'))->json('data.id');
        $pillsId = $this->getJson($this->storeUrl('products/pills'))->json('data.id');
        $this->putJson("/api/v1/online-catalog/products/{$shirtId}/related", ['related' => [], 'frequently_bought' => [$pillsId]])->assertOk();
        $this->asVisitor();

        $shirt = $this->related('shirt');
        $this->assertSame([['Pills'], 'manual'], [array_column($shirt['frequently_bought'], 'name'), $shirt['frequently_bought_source']]);
    }

    public function test_the_nightly_run_computes_once_per_organization_and_local_day_from_three_oclock(): void
    {
        $organization = Organization::query()->findOrFail($this->tenant['organization']->id);
        $timezone = (string) $organization->timezone;
        Date::setTestNow(CarbonImmutable::parse('2026-11-20 01:00', $timezone));
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        $score = fn () => (int) DB::table('product_affinities')->where('organization_id', $organization->id)->max('score');

        Date::setTestNow(CarbonImmutable::parse('2026-11-20 02:59', $timezone));
        $this->artisan('pos:affinities:compute --nightly')->assertSuccessful();
        $this->assertSame(0, DB::table('product_affinities')->count(), 'Not before 03:00 local time.');

        Date::setTestNow(CarbonImmutable::parse('2026-11-20 03:10', $timezone));
        $this->artisan('pos:affinities:compute --nightly')->assertSuccessful();
        $this->assertSame(2, $score());
        $this->assertSame('2026-11-20', substr((string) DB::table('product_affinity_runs')->where('organization_id', $organization->id)->value('local_date'), 0, 10));

        // Once a day: a new order waits for the next night (or a manual run).
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        Date::setTestNow(CarbonImmutable::parse('2026-11-20 23:50', $timezone));
        $this->artisan('pos:affinities:compute --nightly')->assertSuccessful();
        $this->assertSame(2, $score());
        Date::setTestNow(CarbonImmutable::parse('2026-11-21 03:00', $timezone));
        $this->artisan('pos:affinities:compute --nightly')->assertSuccessful();
        $this->assertSame(3, $score());

        $this->artisan('pos:affinities:compute', ['--organization' => 'not-an-id'])->assertFailed();
    }

    public function test_scores_stay_inside_their_organization(): void
    {
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 1]);

        // Another store sells the same kind of products together.
        $other = $this->openStore('Other Shop', 'other.test');
        $tea = $this->makeProduct($other['unit']->id, 'Tea', [['TEA', '50.00']], ['track_stock' => false]);
        $cake = $this->makeProduct($other['unit']->id, 'Cake', [['CAKE', '90.00']], ['track_stock' => false]);
        $this->publish($tea['id']);
        $this->publish($cake['id']);
        $this->asVisitor();

        $this->artisan('pos:affinities:compute', ['--organization' => $other['organization']->id])->assertSuccessful();
        $this->assertSame(0, DB::table('product_affinities')->count(), 'Only the organization asked for is computed.');

        $this->artisan('pos:affinities:compute')->assertSuccessful();
        $this->assertSame([$this->tenant['organization']->id], DB::table('product_affinities')->distinct()->pluck('organization_id')->all());
        $this->assertSame(['Rice'], array_column($this->related('shirt')['frequently_bought'], 'name'));
        $this->assertSame([], $this->related('tea', 'other.test')['frequently_bought']);
    }
}
