<?php

namespace App\Modules\System\Infrastructure\Performance;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * G1c: the heavy read paths measured by `pos:perf:explain`, as real API requests with
 * realistic parameters against the data of `pos:perf:seed` (the largest organization).
 */
final class PerfScenarios
{
    /** Target server time of an API read path (ms). */
    public const TARGET_MS = 300;

    /** Target server time of the dashboard (ms). */
    public const DASHBOARD_TARGET_MS = 1000;

    /**
     * @return array{organization_id: string, owner_id: string, manager_id: ?string, host: string,
     *               scenarios: list<array{name: string, path: string, query: array<string, mixed>, as: ?string, host: ?string, target: int, reset_insights?: bool}>}
     */
    public static function build(?string $organizationId = null): array
    {
        $org = $organizationId !== null
            ? DB::table('organizations')->where('id', $organizationId)->first(['id', 'timezone'])
            : DB::table('organizations')->where('slug', 'perf-mart')->first(['id', 'timezone']);
        if ($org === null) {
            throw new RuntimeException('No performance organization found. Run `php artisan pos:perf:seed` first (or pass --organization=).');
        }
        $o = $org->id;
        $owner = DB::table('users')->where('organization_id', $o)->where('email', PerfDataSeeder::OWNER_EMAIL)->value('id')
            ?? DB::table('users as u')->join('role_user as ru', 'ru.user_id', '=', 'u.id')->join('roles as r', 'r.id', '=', 'ru.role_id')
                ->where('u.organization_id', $o)->where('r.system_key', 'organization_admin')->orderBy('u.created_at')->value('u.id');
        if ($owner === null) {
            throw new RuntimeException('The organization has no administrator to run the requests as.');
        }
        $manager = DB::table('users')->where('organization_id', $o)->where('email', PerfDataSeeder::MANAGER_EMAIL)->value('id');
        $host = (string) (DB::table('storefront_domains')->where('organization_id', $o)->orderByDesc('is_primary')->value('host') ?? '');

        $branch = DB::table('branches')->where('organization_id', $o)->orderBy('code')->value('id');
        $store = DB::table('stores')->where('organization_id', $o)->where('branch_id', $branch)->where('type', 'store')->orderBy('code')->value('id');
        // The best-selling variant's barcode and SKU, a regular customer, a mid-size category.
        $variant = DB::table('sale_lines')->where('organization_id', $o)->where('created_at', '>=', now()->subDays(30))
            ->groupBy('variant_id')->orderByRaw('count(*) desc')->value('variant_id')
            ?? DB::table('product_variants')->where('organization_id', $o)->value('id');
        $barcode = (string) DB::table('product_barcodes')->where('variant_id', $variant)->value('barcode');
        $sku = (string) DB::table('product_variants')->where('id', $variant)->value('sku');
        $customer = DB::table('sales')->where('organization_id', $o)->whereNotNull('customer_id')->where('sold_at', '>=', now()->subDays(90))
            ->groupBy('customer_id')->orderByRaw('count(*) desc')->value('customer_id');
        $customerPhone = (string) DB::table('customers')->where('id', $customer)->value('phone');
        $order = DB::table('orders')->where('organization_id', $o)->orderByDesc('placed_at')->skip(500)->value('number');
        $department = DB::table('category_listings as cl')->join('categories as c', 'c.id', '=', 'cl.category_id')
            ->where('cl.organization_id', $o)->whereNull('c.parent_id')->orderBy('c.sort_order')->value('cl.slug');
        $aisle = DB::table('category_listings as cl')->join('categories as c', 'c.id', '=', 'cl.category_id')
            ->where('cl.organization_id', $o)->whereNotNull('c.parent_id')->orderBy('c.sort_order')->value('cl.slug');

        $today = CarbonImmutable::now($org->timezone)->startOfDay();
        $d30 = ['date_from' => $today->subDays(29)->toDateString(), 'date_to' => $today->toDateString()];
        $d12m = ['date_from' => $today->subYear()->addDay()->toDateString(), 'date_to' => $today->toDateString()];

        $api = fn (string $name, string $path, array $query = [], ?string $as = 'owner', int $target = self::TARGET_MS, array $extra = []) => [
            'name' => $name, 'path' => '/api/v1/'.$path, 'query' => $query, 'as' => $as, 'host' => null, 'target' => $target,
        ] + $extra;
        $shop = fn (string $name, string $path, array $query = []) => [
            'name' => $name, 'path' => '/api/v1/store/'.$path, 'query' => $query, 'as' => null, 'host' => $host, 'target' => self::TARGET_MS,
        ];

        $scenarios = [
            $api('dashboard.today', 'dashboard', [], 'owner', self::DASHBOARD_TARGET_MS),
            $api('dashboard.30d', 'dashboard', $d30, 'owner', self::DASHBOARD_TARGET_MS),
            $api('dashboard.30d.branch_manager', 'dashboard', $d30, 'manager', self::DASHBOARD_TARGET_MS),
        ];
        foreach (['sales_daily', 'profit_and_loss', 'tax', 'sales_by_product', 'sales_by_category', 'sales_by_customer'] as $key) {
            $scenarios[] = $api("report.{$key}.30d", "reports/{$key}", $d30);
            $scenarios[] = $api("report.{$key}.12m", "reports/{$key}", $d12m);
        }
        $scenarios[] = $api('report.sales_monthly.12m', 'reports/sales_monthly', $d12m);
        $scenarios[] = $api('report.sales_daily.12m.branch_manager', 'reports/sales_daily', $d12m, 'manager');
        $scenarios[] = $api('report.inventory_valuation', 'reports/inventory_valuation');
        $scenarios[] = $api('report.low_stock', 'reports/low_stock');

        array_push($scenarios,
            $api('sales.list', 'sales'),
            $api('sales.list.filtered', 'sales', ['branch_id' => $branch, 'status' => 'completed', 'from' => $d30['date_from'], 'to' => $d30['date_to']]),
            $api('sales.list.customer', 'sales', ['customer_id' => $customer]),
            $api('sales.list.search', 'sales', ['search' => 'INV-B1-00123']),
            $api('inventory.stock', 'inventory/stock', ['store_id' => $store]),
            $api('inventory.stock.search', 'inventory/stock', ['store_id' => $store, 'search' => 'rice']),
            $api('inventory.stock.low', 'inventory/stock', ['low_stock' => 1]),
            $api('pos.catalog', 'pos/catalog', ['store_id' => $store]),
            $api('pos.catalog.search', 'pos/catalog', ['store_id' => $store, 'search' => 'rice']),
            $api('pos.lookup.barcode', 'pos/lookup', ['store_id' => $store, 'code' => $barcode]),
            $api('pos.lookup.sku', 'pos/lookup', ['store_id' => $store, 'code' => $sku]),
            $api('products.list.search', 'products', ['search' => 'tea']),
            $shop('store.products.all', 'products'),
            $shop('store.products.department', 'products', ['category' => $department, 'sort' => 'price_asc']),
            $shop('store.products.aisle', 'products', ['category' => $aisle, 'sort' => 'popularity']),
            $shop('store.products.facets', 'products', ['category' => $department, 'price_min' => '100', 'price_max' => '2000', 'in_stock' => 1, 'attr' => ['size' => ['m']], 'sort' => 'latest']),
            $shop('store.products.search', 'products', ['q' => 'tea']),
            $shop('store.search.suggest', 'search/suggest', ['q' => 'tea']),
            $api('web_orders.list', 'web-orders'),
            $api('web_orders.status', 'web-orders', ['status' => 'processing']),
            $api('web_orders.search', 'web-orders', ['search' => (string) $order]),
            $api('web_orders.search.phone', 'web-orders', ['search' => $customerPhone]),
            $api('customers.list', 'customers'),
            $api('customers.search.name', 'customers', ['search' => 'rahim']),
            $api('customers.search.phone', 'customers', ['search' => substr($customerPhone, 0, 7)]),
            $api('audit.list', 'audit-logs'),
            $api('audit.filtered', 'audit-logs', ['action' => 'web_order.*', 'from' => $d30['date_from']]),
            $api('ai.insights.daily', 'ai/insights', ['period' => 'daily'], 'owner', self::TARGET_MS, ['reset_insights' => true]),
            $api('ai.insights.monthly', 'ai/insights', ['period' => 'monthly'], 'owner', self::TARGET_MS, ['reset_insights' => true]),
            $api('ai.customer_insights', 'ai/customer-insights'),
            $api('purchasing.reorder', 'purchasing/reorder-suggestions', ['store_id' => $store]),
            $api('purchasing.reorder.search', 'purchasing/reorder-suggestions', ['store_id' => $store, 'search' => 'rice']),
        );

        return ['organization_id' => $o, 'owner_id' => $owner, 'manager_id' => $manager, 'host' => $host,
            'scenarios' => array_values(array_filter($scenarios, fn (array $s) => ($s['as'] !== 'manager' || $manager !== null) && ($s['host'] === null || $s['host'] !== '')))];
    }
}
