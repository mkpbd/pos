<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Catalog\Application\Actions\SaveCategory;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\OnlineCatalog\Application\Actions\SaveProductListing;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Application\Actions\PlaceOrder;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Payments\Application\Actions\CloseRegisterSession;
use App\Modules\Payments\Application\Actions\OpenRegisterSession;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Sales\Application\Actions\CompleteSale;
use App\Modules\Sales\Application\Actions\RequestSaleReturn;
use App\Modules\Sales\Application\Services\CartPricer;
use App\Modules\Sales\Domain\ReturnShare;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shipping\Infrastructure\Models\Courier;
use App\Modules\Users\Application\Actions\CreateUser;
use App\Modules\Users\Application\DTOs\UserData;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

/**
 * Phase 7: sixty days of trading history for the reports and the dashboard, through the real
 * use cases (stock ledger, invoices, payments ledger, register sessions, returns, web orders)
 * — and only on products of its own, so nothing the end-to-end tests count changes (juice 54,
 * rice, polo shirts, Rahman Traders, PO-/GRN- numbers, the owner's and cashier's open shifts):
 *
 * - four products: Butter Cookies 200g (VAT 15 %, category Snacks under Grocery), Atta Flour 2kg
 *   (no VAT, Grocery), Bath Soap 100g (VAT 15 %, batch-tracked, Household — a batch expiring 12
 *   days after seeding), Dishwashing Liquid 500ml (VAT 7.5 %, Household; reorder level above its
 *   stock, so it shows as low stock);
 * - opening stock 61 days ago (adjustment ADJ-…);
 * - user "Demo Floor Manager" (manager@demo.test / password, Branch Manager of Dhaka Main) on a
 *   new register "T3 — Counter 2": one shift per day for the last 60 days and today (opened at
 *   09:00 with a 500 float, closed at 21:00 counting exactly the expected cash), 3–6 POS sales a
 *   day paid by cash, card or mobile banking, and a return of one item every 7th day (refunded
 *   the way it was paid; INV-MAIN-/RET-MAIN-/SES-MAIN- numbers after the existing ones);
 * - six delivered guest web orders (cash on delivery with the RedX courier, COD recorded) of the
 *   new products, numbered after WEB-000003 (WEB-000004…WEB-000009); their listings are published
 *   only while ordering, so the storefront catalogue is unchanged.
 */
class DemoReportsSeeder extends Seeder
{
    private const DAYS = 60;

    public function run(
        string $organizationId,
        string $adminId,
        TenantContext $tenant,
        SaveCategory $saveCategory,
        SaveProduct $saveProduct,
        PostStockAdjustment $postAdjustment,
        CreateUser $createUser,
        OpenRegisterSession $openSession,
        CloseRegisterSession $closeSession,
        CompleteSale $completeSale,
        CartPricer $pricer,
        StoreAccess $storeAccess,
        RequestSaleReturn $requestReturn,
    ): void {
        $tenant->runAs($organizationId, function () use ($organizationId, $adminId, $saveCategory, $saveProduct, $postAdjustment, $createUser, $openSession, $closeSession, $completeSale, $pricer, $storeAccess, $requestReturn) {
            $timezone = (string) Organization::query()->whereKey($organizationId)->value('timezone');
            $admin = User::query()->findOrFail($adminId);
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $now = CarbonImmutable::now($timezone);
            $today = $now->startOfDay();
            $at = fn (CarbonImmutable $day, int $hour, int $minute = 0) => Carbon::setTestNow($day->setTime($hour, $minute)->utc());

            try {
                $manager = $createUser(new UserData(
                    name: 'Demo Floor Manager',
                    email: 'manager@demo.test',
                    password: 'password',
                    roleIds: [Role::query()->where('system_key', SystemRole::BranchManager->value)->firstOrFail()->id],
                    branchIds: [$store->branch_id],
                ));
                $products = $this->products($saveCategory, $saveProduct);
                $variant = fn (string $name) => Product::query()->where('name', $name)->firstOrFail()->variants()->firstOrFail();

                // Opening stock, the day before the history starts.
                $at($today->subDays(self::DAYS + 1), 8);
                $postAdjustment($admin, [
                    'store_id' => $store->id,
                    'reason' => 'opening',
                    'note' => 'Opening stock for the demo sales history',
                    'lines' => [
                        ['variant_id' => $variant($products[0])->id, 'quantity' => '600', 'unit_cost' => '28.00'],
                        ['variant_id' => $variant($products[1])->id, 'quantity' => '400', 'unit_cost' => '95.00'],
                        ['variant_id' => $variant($products[2])->id, 'quantity' => '400', 'unit_cost' => '38.00', 'batch_number' => 'SOAP-A', 'expires_on' => $today->addDays(12)->toDateString()],
                        ['variant_id' => $variant($products[2])->id, 'quantity' => '200', 'unit_cost' => '40.00', 'batch_number' => 'SOAP-B', 'expires_on' => $today->addYear()->toDateString()],
                        ['variant_id' => $variant($products[3])->id, 'quantity' => '330', 'unit_cost' => '70.00'],
                    ],
                ]);

                $register = CashRegister::query()->create(['branch_id' => $store->branch_id, 'code' => 'T3', 'name' => 'Counter 2']);
                $storeData = $storeAccess->require($manager, $store->id);
                $methods = ['cash', 'card', 'mobile_banking', 'cash'];
                mt_srand(20261107);
                $saleNo = 0;

                for ($offset = self::DAYS; $offset >= 0; $offset--) {
                    // Past days: 09:00–21:00; today: a short shift ending just before now.
                    $day = $today->subDays($offset);
                    $moment = fn (int $hour, int $minute = 0) => $offset > 0 ? $at($day, $hour, $minute) : Carbon::setTestNow($now->subMinutes(200 - ($hour - 9) * 15 - intdiv($minute, 4))->utc());
                    $moment(9);
                    $session = $openSession($manager->fresh(), $register, '500.00');
                    $count = $offset === 0 ? 2 : 3 + mt_rand(0, 3);
                    $lastSale = null;
                    for ($i = 0; $i < $count; $i++) {
                        $moment(10 + $i * 2, mt_rand(0, 59));
                        $lines = [];
                        foreach ((array) array_rand(array_flip($products), mt_rand(1, 3)) as $name) {
                            $lines[] = ['variant_id' => $variant((string) $name)->id, 'quantity' => (string) mt_rand(1, 3)];
                        }
                        $cart = ['store_id' => $store->id, 'lines' => $lines];
                        $total = (string) $pricer->price($manager, $storeData, $cart)['total'];
                        $method = $methods[$saleNo++ % count($methods)];
                        // Cash is tendered in 50s (change given); card and mobile banking pay exactly.
                        $amount = $method === 'cash' ? Decimal::mul(Decimal::ceil(Decimal::div($total, '50', 6)), '50', 2) : $total;
                        $lastSale = $completeSale($manager, $cart + ['payments' => [['method' => $method, 'amount' => $amount]]]);
                    }
                    if ($offset > 0 && $offset % 7 === 0 && $lastSale !== null) {
                        $this->returnOne($requestReturn, $manager, $lastSale);
                    }
                    $moment(21);
                    $closeSession($manager->fresh(), $session->fresh(), $this->expectedCash($session->id), 'Demo shift');
                }

                $this->webOrders($today, $products, $variant, $adminId, $at);
            } finally {
                Carbon::setTestNow();
            }
        });
    }

    /**
     * @return list<string> product names
     */
    private function products(SaveCategory $saveCategory, SaveProduct $saveProduct): array
    {
        $grocery = Category::query()->where('name', 'Grocery')->firstOrFail();
        $snacks = $saveCategory(null, ['name' => 'Snacks', 'parent_id' => $grocery->id]);
        $household = $saveCategory(null, ['name' => 'Household']);
        $pcs = Unit::query()->where('code', 'pcs')->firstOrFail();
        $vat15 = TaxRate::query()->where('rate', '15')->firstOrFail();
        $vat75 = TaxRate::query()->where('rate', '7.5')->firstOrFail();
        $create = fn (array $data) => $saveProduct(null, ProductData::fromArray($data + ['type' => 'standard', 'unit_id' => $pcs->id, 'is_active' => true, 'track_stock' => true]));

        $create(['name' => 'Butter Cookies 200g', 'category_id' => $snacks->id, 'tax_rate_id' => $vat15->id,
            'variants' => [['sku' => 'DEMO-COOKIES-200', 'purchase_price' => '28.00', 'selling_price' => '40.00', 'reorder_level' => '40']]]);
        $create(['name' => 'Atta Flour 2kg', 'category_id' => $grocery->id,
            'variants' => [['sku' => 'DEMO-ATTA-2KG', 'purchase_price' => '95.00', 'selling_price' => '120.00', 'reorder_level' => '30']]]);
        $create(['name' => 'Bath Soap 100g', 'category_id' => $household->id, 'tax_rate_id' => $vat15->id, 'track_batches' => true,
            'variants' => [['sku' => 'DEMO-SOAP-100', 'purchase_price' => '38.00', 'selling_price' => '55.00', 'reorder_level' => '30']]]);
        $create(['name' => 'Dishwashing Liquid 500ml', 'category_id' => $household->id, 'tax_rate_id' => $vat75->id,
            'variants' => [['sku' => 'DEMO-DISH-500', 'purchase_price' => '70.00', 'selling_price' => '95.00', 'reorder_level' => '120']]]);

        return ['Butter Cookies 200g', 'Atta Flour 2kg', 'Bath Soap 100g', 'Dishwashing Liquid 500ml'];
    }

    /**
     * One unit of the sale's first line comes back (restocked), refunded the way it was paid.
     */
    private function returnOne(RequestSaleReturn $requestReturn, User $manager, Sale $sale): void
    {
        $line = $sale->lines()->orderBy('position')->firstOrFail();
        $share = ReturnShare::of(
            ['quantity' => (string) $line->quantity, 'line_total' => (string) $line->line_total, 'tax_amount' => (string) $line->tax_amount, 'cost_total' => (string) $line->cost_total],
            ['quantity' => '0', 'line_total' => '0', 'tax_amount' => '0', 'cost_total' => '0'],
            '1',
            (string) $sale->currency,
        );
        $method = $sale->payments()->firstOrFail()->method->value;
        $requestReturn($manager, [
            'sale_id' => $sale->id,
            'notes' => 'Customer changed their mind',
            'lines' => [['sale_line_id' => $line->id, 'quantity' => '1', 'restock' => true]],
            'refunds' => [['method' => $method, 'amount' => $share['line_total']]],
        ]);
    }

    /**
     * Float + cash in − cash out of the session (what the count must show).
     */
    private function expectedCash(string $sessionId): string
    {
        $session = DB::table('cash_register_sessions')->where('id', $sessionId)->first(['opening_float']);
        $in = (string) DB::table('payments')->where('cash_register_session_id', $sessionId)->where('method', 'cash')->where('direction', 'in')->sum('amount');
        $out = (string) DB::table('payments')->where('cash_register_session_id', $sessionId)->where('method', 'cash')->where('direction', 'out')->sum('amount');

        return Decimal::round(Decimal::sub(Decimal::add((string) $session->opening_float, $in, 6), $out, 6), 2);
    }

    /**
     * Six delivered guest COD orders, one every ten days; listings published only meanwhile.
     *
     * @param  list<string>  $products
     * @param  callable(string): ProductVariant  $variant
     * @param  callable(CarbonImmutable, int, int=): void  $at
     */
    private function webOrders(CarbonImmutable $today, array $products, callable $variant, string $adminId, callable $at): void
    {
        $saveListing = app(SaveProductListing::class);
        $carts = app(ShoppingCart::class);
        $quoter = app(CheckoutQuoter::class);
        $place = app(PlaceOrder::class);
        $workflow = app(OrderWorkflow::class);
        $courier = Courier::query()->where('name', 'RedX')->value('id');
        $online = [$products[0], $products[1]];
        if ($courier === null) {
            return;
        }
        $productIds = array_map(fn (string $name) => Product::query()->where('name', $name)->value('id'), $online);
        $dhakaDivision = (int) DB::table('geo_divisions')->where('name_en', 'Dhaka')->value('id');
        $dhaka = (int) DB::table('geo_districts')->where('division_id', $dhakaDivision)->where('name_en', 'Dhaka')->value('id');

        foreach ($productIds as $productId) {
            $saveListing($productId, ['is_published' => true, 'short_description' => 'Demo product for the sales history.']);
        }
        try {
            foreach ([55, 45, 35, 25, 15, 5] as $n => $daysAgo) {
                $day = $today->subDays($daysAgo);
                $at($day, 11, $n * 7);
                // The first add creates the guest cart and hands back its cookie token.
                [, $token] = $carts->add(CartOwner::guest(null), $variant($online[$n % 2])->id, (string) (2 + $n % 3));
                $owner = CartOwner::guest($token);
                if ($n % 2 === 0) {
                    $carts->add($owner, $variant($online[1])->id, '1');
                }
                $address = [
                    'recipient_name' => 'Demo Guest '.($n + 1), 'phone' => '0171100020'.$n, 'division_id' => $dhakaDivision, 'district_id' => $dhaka,
                    'area' => 'Mirpur', 'address_line' => 'House '.(10 + $n).', Road 3', 'postcode' => '1216',
                ];
                $input = ['address' => $address, 'payment_method' => 'cod'];
                $preview = $quoter->quote($carts->find($owner), $input, null, autoPickMethod: true)['preview'];
                $order = Event::fakeFor(fn () => $place($owner, null, $input + [
                    'contact' => ['name' => $address['recipient_name'], 'email' => 'guest'.($n + 1).'@demo.test', 'phone' => $address['phone']],
                    'shipping_method_id' => $preview['shipping_method_id'],
                    'notes' => null,
                    'save_address' => false,
                    'expected_total' => $preview['total'],
                ], ['ip' => null, 'user_agent' => 'Demo seeder', 'site_url' => (string) config('app.url')])['order'], [OrderPlaced::class]);

                $at($day, 15);
                $order = $workflow->process($order, $adminId);
                $order = $workflow->ship($order->fresh(), $courier, 'DEMO-RX-'.str_pad((string) ($n + 1), 4, '0', STR_PAD_LEFT), null, $adminId);
                $at($day->addDay(), 13);
                $order = $workflow->deliver($order->fresh(), $adminId);
                $workflow->recordCodPayment($order->fresh(), 'DEMO-COD-RX-'.($n + 1), $adminId);
            }
        } finally {
            foreach ($productIds as $productId) {
                $saveListing($productId, ['is_published' => false]);
            }
        }
    }
}
