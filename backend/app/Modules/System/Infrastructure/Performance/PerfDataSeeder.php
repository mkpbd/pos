<?php

namespace App\Modules\System\Infrastructure\Performance;

use App\Modules\Branches\Application\Actions\CreateBranch;
use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

/**
 * G1c: production-sized data for `EXPLAIN` (development and testing databases only).
 *
 * One large organization ("Perf Mart": 5 branches, 10 stores, at scale 1 about 50 000 products,
 * 80 000 variants, 200 000 customers, 600 000 sales with 2 000 000 lines over two years,
 * 150 000 web orders, 3 000 000 stock movements, 50 000 purchase order lines, audit and sign-in
 * rows) plus a few small organizations so tenant filters have something to filter out.
 *
 * The organizations, branches and their default stores come from the real provisioning
 * actions; everything else is bulk SQL (`INSERT … SELECT generate_series`, PostgreSQL 18
 * `uuidv7(shift)` so keys are time-ordered like the application's UUIDv7). The rows satisfy
 * every CHECK constraint and foreign key; append-only tables only receive inserts. The data is
 * shaped like the application writes it (exclusive tax, completed / cancelled sales, sale and
 * web-order stock movements, payments ledger rows) but no stock ledger replay is done:
 * `stock_levels` quantities are synthetic and `balance_after` is not a running balance.
 *
 * Writes across modules on purpose — this is a seeding tool like `database/seeders`, never
 * called by the application.
 */
final class PerfDataSeeder
{
    public const SLUG_PREFIX = 'perf-';

    public const MAIN_NAME = 'Perf Mart';

    public const MAIN_HOST = 'perf-mart.shop.test';

    public const OWNER_EMAIL = 'perf-owner@perf.test';

    public const MANAGER_EMAIL = 'perf-manager@perf.test';

    public const PASSWORD = 'password';

    /** Base volumes at scale 1. */
    private const BASE = [
        'products' => 50_000,
        'customers' => 200_000,
        'sales' => 600_000,
        'orders' => 150_000,
        'movements' => 3_000_000,
        'purchase_orders' => 5_000,
        'expenses' => 8_000,
        'audit' => 500_000,
        'logins' => 60_000,
        'suppliers' => 500,
        'brands' => 300,
        'categories' => 200,
    ];

    private const DAYS = 730;

    private const CHUNKS = 24;

    /** @var Closure(string): void */
    private Closure $log;

    public function __construct(
        private readonly ProvisionOrganization $provision,
        private readonly CreateBranch $createBranch,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  Closure(string): void  $log
     * @return array{organization_id: string, counts: array<string, int>, small: list<string>}
     */
    public function seed(float $scale, int $smallOrganizations, Closure $log): array
    {
        if (DB::getDriverName() !== 'pgsql') {
            throw new RuntimeException('The performance seed needs PostgreSQL (18+, for uuidv7).');
        }
        if (DB::table('organizations')->where('slug', 'like', self::SLUG_PREFIX.'%')->exists()) {
            throw new RuntimeException('Performance organizations already exist. Run `php artisan migrate:fresh --seed` first.');
        }
        $this->log = $log;

        DB::statement("SET synchronous_commit = 'off'");
        DB::statement("SET work_mem = '256MB'");

        $main = $this->seedOrganization(self::MAIN_NAME, 'pm', self::OWNER_EMAIL, self::MAIN_HOST, $scale, branches: 5, withManager: true);
        $small = [];
        for ($i = 1; $i <= $smallOrganizations; $i++) {
            $small[] = $this->seedOrganization("Perf Small {$i}", "s{$i}", "perf-small-{$i}@perf.test", "perf-small-{$i}.shop.test", max(0.001, $scale / 100), branches: 1, withManager: false)['organization_id'];
        }

        // VACUUM sets the visibility map (index-only scans) like autovacuum would in production;
        // inside a transaction (tests) only ANALYZE is possible.
        $this->step('vacuum analyze', function () {
            $command = DB::transactionLevel() > 0 ? 'ANALYZE' : 'VACUUM (ANALYZE)';
            foreach (self::TABLES as $table) {
                DB::statement("{$command} {$table}");
            }
        });

        return ['organization_id' => $main['organization_id'], 'counts' => $main['counts'], 'small' => $small];
    }

    /** Tables the seed writes (vacuumed and analyzed at the end). */
    private const TABLES = ['categories', 'brands', 'category_listings', 'brand_listings', 'products', 'product_variants', 'product_barcodes',
        'product_listings', 'variant_listings', 'product_images', 'customers', 'customer_accounts', 'stock_levels', 'stock_movements',
        'sales', 'sale_lines', 'sale_payments', 'sale_returns', 'sale_return_lines', 'payments', 'orders', 'order_lines', 'order_addresses',
        'suppliers', 'supplier_products', 'purchase_orders', 'purchase_order_lines', 'expenses', 'expense_categories', 'audit_logs',
        'login_activities', 'users', 'branch_user', 'role_user', 'stores', 'branches'];

    /**
     * @return array{organization_id: string, counts: array<string, int>}
     */
    private function seedOrganization(string $name, string $tag, string $ownerEmail, string $host, float $scale, int $branches, bool $withManager): array
    {
        $n = fn (string $key, int $min = 1) => max($min, (int) round(self::BASE[$key] * $scale));
        $p = [
            'P' => $n('products', 20),
            'C' => $n('customers', 50),
            'S' => $n('sales', 100),
            'O' => $n('orders', 30),
            'MOV' => $n('movements', 100),
            'PO' => $n('purchase_orders', 5),
            'EXP' => $n('expenses', 10),
            'AUD' => $n('audit', 50),
            'LOG' => $n('logins', 20),
            'NS' => $n('suppliers', 3),
            'B' => $n('brands', 3),
            'TOP' => max(2, (int) round($n('categories', 4) / 10)),
        ];
        $p['CHILD'] = max(2, $n('categories', 4) - $p['TOP']);
        $p['MULTI'] = (int) round($p['P'] * 0.6);
        $p['CA'] = max(10, intdiv($p['C'], 4));
        $p['NB'] = $branches;
        $p['days'] = self::DAYS;
        $p['start'] = CarbonImmutable::now('UTC')->subDays(self::DAYS)->startOfDay()->format('Y-m-d H:i:sP');
        $p['tag'] = $tag;

        ($this->log)("== {$name} (scale {$scale}): {$p['P']} products, {$p['C']} customers, {$p['S']} sales, {$p['O']} web orders");

        // Organization, branches and their default stores through the real actions.
        $org = null;
        $this->step('organization', function () use (&$org, $name, $ownerEmail, $branches) {
            $result = ($this->provision)(new ProvisionOrganizationData(
                organizationName: $name,
                adminName: $name.' Owner',
                adminEmail: $ownerEmail,
                adminPassword: self::PASSWORD,
                currency: (string) config('pos.default_currency', 'BDT'),
                timezone: (string) config('pos.default_timezone', 'Asia/Dhaka'),
                branchName: 'Branch 1',
                branchCode: 'B1',
            ));
            $org = ['id' => $result['organization']->id, 'admin' => $result['admin']->id, 'currency' => $result['organization']->base_currency];
            $this->tenant->runAs($org['id'], function () use ($branches) {
                for ($i = 2; $i <= $branches; $i++) {
                    ($this->createBranch)(['code' => "B{$i}", 'name' => "Branch {$i}"]);
                }
            });
        });
        $p['o'] = $org['id'];
        $p['admin'] = $org['admin'];
        $p['cur'] = $org['currency'];

        $this->step('reference data, users, stores', function () use ($p, $withManager, $tag) {
            $this->setupReferenceData($p, $withManager, $tag);
        });
        $p['unit'] = (string) DB::table('units')->where('organization_id', $p['o'])->where('code', 'pcs')->value('id');

        $this->sql('categories and brands', $p, self::TAXONOMY_SQL);
        $this->sql('products and variants (temp)', $p, self::PRODUCT_TEMP_SQL);
        $this->sql('products', $p, self::PRODUCTS_SQL);
        $this->sql('variants and barcodes', $p, self::VARIANTS_SQL);
        $this->sql('listings and images', $p, self::LISTINGS_SQL);
        $this->sql('customers and accounts', $p, self::CUSTOMERS_SQL);
        $this->sql('stock levels and opening movements', $p, self::STOCK_SQL);

        $perChunk = fn (int $total, int $c) => [intdiv($total * ($c - 1), self::CHUNKS) + 1, intdiv($total * $c, self::CHUNKS)];
        $this->step('sales and web orders ('.self::CHUNKS.' monthly chunks)', function () use ($p, $perChunk) {
            for ($c = 1; $c <= self::CHUNKS; $c++) {
                [$a, $b] = $perChunk($p['S'], $c);
                if ($a <= $b) {
                    $this->run($p + ['a' => $a, 'b' => $b], self::SALES_CHUNK_SQL);
                }
                [$a, $b] = $perChunk($p['O'], $c);
                if ($a <= $b) {
                    $this->run($p + ['a' => $a, 'b' => $b], self::ORDERS_CHUNK_SQL);
                }
            }
        });

        $existing = (int) DB::table('stock_movements')->where('organization_id', $p['o'])->count();
        $p['FILL'] = max(0, $p['MOV'] - $existing);
        $this->sql('purchasing, receipts movements, expenses', $p, self::PURCHASING_SQL);
        $this->sql('audit and sign-in history', $p, self::HISTORY_SQL);
        $this->run($p, self::CLEANUP_SQL);

        $counts = [];
        foreach (['products', 'product_variants', 'customers', 'sales', 'sale_lines', 'orders', 'order_lines', 'stock_levels', 'stock_movements', 'payments', 'purchase_order_lines', 'audit_logs', 'login_activities'] as $table) {
            $counts[$table] = (int) DB::table($table)->where('organization_id', $p['o'])->count();
        }

        return ['organization_id' => $p['o'], 'counts' => $counts];
    }

    /**
     * @param  array<string, mixed>  $p
     */
    private function setupReferenceData(array $p, bool $withManager, string $tag): void
    {
        $o = $p['o'];
        $now = now();
        $hash = Hash::make(self::PASSWORD);
        $branches = DB::table('branches')->where('organization_id', $o)->orderBy('code')->get(['id', 'code']);
        $roles = DB::table('roles')->where('organization_id', $o)->pluck('id', 'system_key');

        DB::statement('DROP TABLE IF EXISTS perf_br, perf_cashier, perf_tax, perf_grp');
        DB::statement('CREATE TEMP TABLE perf_br (i int PRIMARY KEY, branch_id uuid, store_id uuid, wh_id uuid, code text)');
        DB::statement('CREATE TEMP TABLE perf_cashier (bi int, k int, user_id uuid, PRIMARY KEY (bi, k))');
        DB::statement('CREATE TEMP TABLE perf_tax (i int PRIMARY KEY, id uuid, rate numeric)');
        DB::statement('CREATE TEMP TABLE perf_grp (i int PRIMARY KEY, id uuid)');

        foreach ($branches->values() as $index => $branch) {
            $i = $index + 1;
            $store = DB::table('stores')->where('branch_id', $branch->id)->where('type', 'store')->value('id');
            $warehouse = (string) DB::selectOne('SELECT uuidv7() AS id')->id;
            DB::table('stores')->insert(['id' => $warehouse, 'organization_id' => $o, 'branch_id' => $branch->id, 'code' => 'WH', 'name' => "Warehouse {$i}",
                'type' => 'warehouse', 'is_active' => true, 'created_by' => $p['admin'], 'created_at' => $now, 'updated_at' => $now]);
            DB::table('perf_br')->insert(['i' => $i, 'branch_id' => $branch->id, 'store_id' => $store, 'wh_id' => $warehouse, 'code' => $branch->code]);
            DB::table('branch_user')->insertOrIgnore(['branch_id' => $branch->id, 'user_id' => $p['admin']]);

            for ($k = 1; $k <= 4; $k++) {
                $userId = (string) DB::selectOne('SELECT uuidv7() AS id')->id;
                DB::table('users')->insert(['id' => $userId, 'organization_id' => $o, 'name' => "Cashier {$i}.{$k}", 'email' => "perf-cashier-{$tag}-{$i}-{$k}@perf.test",
                    'password' => $hash, 'status' => 'active', 'email_verified_at' => $now, 'created_by' => $p['admin'], 'created_at' => $now, 'updated_at' => $now]);
                DB::table('role_user')->insert(['role_id' => $roles[SystemRole::Cashier->value], 'user_id' => $userId]);
                DB::table('branch_user')->insert(['branch_id' => $branch->id, 'user_id' => $userId]);
                DB::table('perf_cashier')->insert(['bi' => $i, 'k' => $k, 'user_id' => $userId]);
            }
        }

        if ($withManager) {
            // A branch-scoped user, so scoped report paths can be measured too.
            $userId = (string) DB::selectOne('SELECT uuidv7() AS id')->id;
            DB::table('users')->insert(['id' => $userId, 'organization_id' => $o, 'name' => 'Perf Branch Manager', 'email' => self::MANAGER_EMAIL,
                'password' => $hash, 'status' => 'active', 'email_verified_at' => $now, 'created_by' => $p['admin'], 'created_at' => $now, 'updated_at' => $now]);
            DB::table('role_user')->insert(['role_id' => $roles[SystemRole::BranchManager->value], 'user_id' => $userId]);
            DB::table('branch_user')->insert(['branch_id' => $branches->first()->id, 'user_id' => $userId]);
        }

        $id = fn () => (string) DB::selectOne('SELECT uuidv7() AS id')->id;
        DB::table('units')->insert([
            ['id' => $id(), 'organization_id' => $o, 'name' => 'Piece', 'code' => 'pcs', 'allow_decimal' => false, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
            ['id' => $id(), 'organization_id' => $o, 'name' => 'Kilogram', 'code' => 'kg', 'allow_decimal' => true, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now],
        ]);
        foreach ([1 => ['VAT 5%', '5.0000'], 2 => ['VAT 15%', '15.0000']] as $i => [$label, $rate]) {
            $taxId = $id();
            DB::table('tax_rates')->insert(['id' => $taxId, 'organization_id' => $o, 'name' => $label, 'rate' => $rate, 'is_active' => true, 'created_at' => $now, 'updated_at' => $now]);
            DB::table('perf_tax')->insert(['i' => $i, 'id' => $taxId, 'rate' => $rate]);
        }
        foreach ([1 => ['Wholesale', '5.00'], 2 => ['VIP', '3.00'], 3 => ['Staff', '10.00']] as $i => [$label, $discount]) {
            $groupId = $id();
            DB::table('customer_groups')->insert(['id' => $groupId, 'organization_id' => $o, 'name' => $label, 'discount_percent' => $discount, 'created_at' => $now, 'updated_at' => $now]);
            DB::table('perf_grp')->insert(['i' => $i, 'id' => $groupId]);
        }

        DB::table('storefront_settings')->insert(['id' => $id(), 'organization_id' => $o, 'is_enabled' => true, 'site_name' => 'Perf Shop '.$tag,
            'fulfilment_store_id' => DB::table('perf_br')->where('i', 1)->value('store_id'), 'created_at' => $now, 'updated_at' => $now]);
        DB::table('storefront_domains')->insert(['id' => $id(), 'organization_id' => $o, 'host' => $p['tag'] === 'pm' ? self::MAIN_HOST : "perf-{$tag}.shop.test",
            'is_primary' => true, 'created_at' => $now, 'updated_at' => $now]);
    }

    private const TAXONOMY_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_cat, perf_leaf, perf_brand;
        CREATE TEMP TABLE perf_cat AS
            SELECT g AS i, uuidv7() AS id, NULL::int AS parent_i, 'Department ' || g AS name, g AS sort_order FROM generate_series(1, {TOP}) g
            UNION ALL
            SELECT {TOP} + g, uuidv7(), 1 + (g - 1) % {TOP}, 'Aisle ' || g, g FROM generate_series(1, {CHILD}) g;
        INSERT INTO categories (id, organization_id, parent_id, name, sort_order, is_active, created_by, created_at, updated_at)
            SELECT c.id, '{o}'::uuid, p.id, c.name, c.sort_order, true, '{admin}'::uuid, timestamptz '{start}' - interval '400 days', timestamptz '{start}' - interval '400 days'
            FROM perf_cat c LEFT JOIN perf_cat p ON p.i = c.parent_i ORDER BY c.i;
        CREATE TEMP TABLE perf_leaf AS SELECT i - {TOP} AS i, id FROM perf_cat WHERE parent_i IS NOT NULL;
        CREATE TEMP TABLE perf_brand AS SELECT g AS i, uuidv7() AS id FROM generate_series(1, {B}) g;
        INSERT INTO brands (id, organization_id, name, is_active, created_by, created_at, updated_at)
            SELECT id, '{o}'::uuid, 'Brand ' || lpad(i::text, 4, '0'), true, '{admin}'::uuid, now(), now() FROM perf_brand;
        INSERT INTO category_listings (id, organization_id, category_id, slug, is_visible, created_at, updated_at)
            SELECT uuidv7(), '{o}'::uuid, id, 'cat-' || i, true, now(), now() FROM perf_cat;
        INSERT INTO brand_listings (id, organization_id, brand_id, slug, is_visible, created_at, updated_at)
            SELECT uuidv7(), '{o}'::uuid, id, 'brand-' || i, true, now(), now() FROM perf_brand;
        SQL;

    private const PRODUCT_TEMP_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_prod, perf_var, perf_lv;
        CREATE TEMP TABLE perf_prod AS
            SELECT g AS n, uuidv7(ts - clock_timestamp()) AS id, ts AS created_at,
                1 + (g::bigint * 7919) % {CHILD} AS cat_i,
                CASE WHEN g % 10 = 0 THEN NULL ELSE 1 + (g::bigint * 104729) % {B} END AS brand_i,
                CASE WHEN g % 10 = 0 THEN NULL WHEN g % 10 IN (1, 2) THEN 2 ELSE 1 END AS tax_i,
                (ARRAY['Classic','Premium','Organic','Fresh','Deluxe','Smart','Eco','Royal','Golden','Super','Natural','Pure','Crispy','Soft','Spicy',
                       'Sweet','Herbal','Instant','Family','Mini','Mega','Ultra','Daily','Lite','Pro'])[1 + g % 25]
                || ' ' ||
                (ARRAY['Rice','Tea','Coffee','Soap','Shampoo','Biscuit','Noodles','Oil','Sugar','Salt','Flour','Lentil','Milk','Juice','Water',
                       'Chocolate','Chips','Toothpaste','Detergent','Lotion','Shirt','Saree','Panjabi','Kurta','Jeans','T-Shirt','Sandal','Shoe','Bag','Wallet',
                       'Cap','Scarf','Towel','Bedsheet','Pillow','Mug','Plate','Bottle','Lamp','Fan','Charger','Cable','Headphone','Speaker','Mouse',
                       'Keyboard','Notebook','Pen','Pencil','Marker','Honey','Ghee','Spice','Masala','Pickle','Jam','Butter','Cheese','Yogurt','Cereal'])[1 + (g / 25) % 60]
                || ' ' || g AS name,
                g <= {MULTI} AS multi,
                g % 200 <> 0 AS active,
                g % 250 = 0 AS archived
            FROM (SELECT g, timestamptz '{start}' - interval '400 days' + (g::float8 / {P}) * interval '395 days' AS ts FROM generate_series(1, {P}) g) x;
        CREATE UNIQUE INDEX ON perf_prod (n);
        CREATE TEMP TABLE perf_var AS
            SELECT (row_number() OVER (ORDER BY p.n, k))::int AS vn, uuidv7(p.created_at - clock_timestamp()) AS id, p.n AS pn, p.id AS product_id, k,
                'PF-' || lpad(p.n::text, 6, '0') || '-' || k AS sku,
                CASE WHEN p.multi THEN (ARRAY['M','L'])[k] END AS opt,
                round((40 + (p.n * 37) % 4960 + (k - 1) * 15)::numeric, 2) AS price,
                round((40 + (p.n * 37) % 4960 + (k - 1) * 15)::numeric * 0.7, 2) AS cost,
                COALESCE(t.rate, 0) AS rate, p.name AS pname, p.created_at,
                (p.active AND NOT p.archived AND p.n % 10 < 6) AS listed
            FROM perf_prod p LEFT JOIN perf_tax t ON t.i = p.tax_i
            CROSS JOIN LATERAL generate_series(1, CASE WHEN p.multi THEN 2 ELSE 1 END) k;
        CREATE UNIQUE INDEX ON perf_var (vn);
        CREATE TEMP TABLE perf_lv AS SELECT (row_number() OVER (ORDER BY vn))::int AS ln, v.* FROM perf_var v WHERE v.listed;
        CREATE UNIQUE INDEX ON perf_lv (ln);
        ANALYZE perf_prod; ANALYZE perf_var; ANALYZE perf_lv;
        SQL;

    private const PRODUCTS_SQL = <<<'SQL'
        INSERT INTO products (id, organization_id, category_id, brand_id, unit_id, tax_rate_id, name, type, track_stock, track_batches, track_serials,
                options, is_active, created_by, updated_by, created_at, updated_at, deleted_at)
            SELECT p.id, '{o}'::uuid, c.id, b.id, '{unit}', t.id, p.name, 'standard', true, false, false,
                CASE WHEN p.multi THEN '[{"name": "Size", "values": ["M", "L"]}]'::jsonb END,
                p.active, '{admin}'::uuid, '{admin}'::uuid, p.created_at, p.created_at, CASE WHEN p.archived THEN p.created_at + interval '30 days' END
            FROM perf_prod p JOIN perf_leaf c ON c.i = p.cat_i LEFT JOIN perf_brand b ON b.i = p.brand_i LEFT JOIN perf_tax t ON t.i = p.tax_i
            ORDER BY p.n;
        SQL;

    private const VARIANTS_SQL = <<<'SQL'
        INSERT INTO product_variants (id, organization_id, product_id, sku, name, option_values, purchase_price, selling_price, reorder_level,
                is_active, sort_order, created_at, updated_at)
            SELECT id, '{o}'::uuid, product_id, sku, NULL, CASE WHEN opt IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('Size', opt) END,
                cost, price, CASE WHEN vn % 3 = 0 THEN 10 ELSE 0 END, true, k - 1, created_at, created_at
            FROM perf_var ORDER BY vn;
        INSERT INTO product_barcodes (id, organization_id, variant_id, barcode, created_at, updated_at)
            SELECT uuidv7(created_at - clock_timestamp()), '{o}'::uuid, id, '29' || lpad(vn::text, 11, '0'), created_at, created_at FROM perf_var ORDER BY vn;
        SQL;

    private const LISTINGS_SQL = <<<'SQL'
        INSERT INTO product_listings (id, organization_id, product_id, slug, is_published, published_at, is_featured, short_description, created_by, created_at, updated_at)
            SELECT uuidv7(p.created_at - clock_timestamp()), '{o}'::uuid, p.id, 'p-' || p.n, true, p.created_at, p.n % 50 = 0,
                'Short description of ' || p.name, '{admin}'::uuid, p.created_at, p.created_at
            FROM perf_prod p WHERE p.active AND NOT p.archived AND p.n % 10 < 6 ORDER BY p.n;
        INSERT INTO product_images (id, organization_id, product_id, path, original_name, mime_type, size, sort_order, created_at, updated_at)
            SELECT uuidv7(p.created_at - clock_timestamp()), '{o}'::uuid, p.id, 'products/perf/' || p.n || '.jpg', p.n || '.jpg', 'image/jpeg', 50000, 0, p.created_at, p.created_at
            FROM perf_prod p WHERE p.active AND NOT p.archived AND p.n % 10 < 6 ORDER BY p.n;
        INSERT INTO variant_listings (id, organization_id, variant_id, compare_at_price, created_at, updated_at)
            SELECT uuidv7(), '{o}'::uuid, id, round(price * 1.25, 2), now(), now() FROM perf_lv WHERE vn % 5 = 0;
        SQL;

    private const CUSTOMERS_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_cust;
        CREATE TEMP TABLE perf_cust AS
            SELECT g AS n, uuidv7(ts - clock_timestamp()) AS id, ts AS created_at,
                (ARRAY['Rahim','Karim','Fatema','Ayesha','Hasan','Hussain','Nusrat','Tanvir','Sadia','Mehedi','Rafiq','Jannat','Sabbir','Farhana','Imran',
                       'Shirin','Arif','Mitu','Sumon','Rina'])[1 + g % 20]
                || ' ' ||
                (ARRAY['Ahmed','Khan','Hossain','Islam','Rahman','Chowdhury','Akter','Begum','Uddin','Sarker','Mia','Das','Roy','Siddique','Talukder',
                       'Biswas','Molla','Sheikh','Haque','Kabir'])[1 + (g / 20) % 20] AS name,
                '01' || (3 + g % 7) || lpad(g::text, 8, '0') AS phone,
                'customer' || g || '@{tag}.perf.test' AS email
            FROM (SELECT g, timestamptz '{start}' - interval '200 days' + (g::float8 / {C}) * interval '{days} days' AS ts FROM generate_series(1, {C}) g) x;
        CREATE UNIQUE INDEX ON perf_cust (n);
        ANALYZE perf_cust;
        INSERT INTO customers (id, organization_id, customer_group_id, code, name, phone, email, credit_limit, opening_balance, is_active, created_by, created_at, updated_at)
            SELECT c.id, '{o}'::uuid, g.id, 'CUS-' || lpad(c.n::text, 7, '0'), c.name, c.phone, c.email, 0, 0, true, '{admin}'::uuid, LEAST(c.created_at, now()), LEAST(c.created_at, now())
            FROM perf_cust c LEFT JOIN perf_grp g ON g.i = CASE WHEN c.n % 10 = 0 THEN 1 + (c.n / 10) % 3 END ORDER BY c.n;
        INSERT INTO customer_accounts (id, organization_id, customer_id, email, phone, password, status, email_verified_at, created_at, updated_at)
            SELECT uuidv7(LEAST(c.created_at, now()) - clock_timestamp()), '{o}'::uuid, c.id, c.email, c.phone, (SELECT password FROM users WHERE id = '{admin}'::uuid), 'active',
                LEAST(c.created_at, now()), LEAST(c.created_at, now()), LEAST(c.created_at, now())
            FROM perf_cust c WHERE c.n <= {CA} ORDER BY c.n;
        SQL;

    private const STOCK_SQL = <<<'SQL'
        INSERT INTO stock_levels (id, organization_id, branch_id, store_id, variant_id, quantity, average_cost, updated_at)
            SELECT uuidv7(), '{o}'::uuid, b.branch_id, b.store_id, v.id,
                CASE WHEN v.vn % 7 = 0 THEN v.vn % 5 ELSE 5 + (v.vn * 13 + b.i) % 150 END, v.cost, now()
            FROM perf_var v CROSS JOIN perf_br b
            UNION ALL
            SELECT uuidv7(), '{o}'::uuid, b.branch_id, b.wh_id, v.id, 20 + (v.vn * 17 + b.i) % 400, v.cost, now()
            FROM perf_var v CROSS JOIN perf_br b WHERE v.vn % 4 = 0;
        INSERT INTO stock_movements (id, organization_id, branch_id, store_id, variant_id, type, quantity, unit_cost, balance_after,
                reference_type, reference_id, reference_number, created_by, created_at)
            SELECT uuidv7(timestamptz '{start}' - interval '1 day' - clock_timestamp()), '{o}'::uuid, l.branch_id, l.store_id, l.variant_id, 'opening', l.quantity + 100,
                l.average_cost, l.quantity + 100, 'stock_adjustment', uuidv7(timestamptz '{start}' - interval '1 day' - clock_timestamp()), 'ADJ-OPEN', '{admin}'::uuid,
                timestamptz '{start}' - interval '1 day'
            FROM stock_levels l WHERE l.organization_id = '{o}'::uuid;
        SQL;

    private const SALES_CHUNK_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_s, perf_sl;
        CREATE TEMP TABLE perf_s AS
            WITH x AS MATERIALIZED (
                SELECT n,
                    LEAST(date_trunc('day', timestamptz '{start}' + ((n - 1)::float8 / {S}) * interval '{days} days') + interval '3 hours' + random() * interval '12 hours',
                          now() - interval '1 minute') AS sold_at,
                    1 + n % {NB} AS bi,
                    1 + (n / {NB}) % 4 AS ck,
                    CASE WHEN random() < 0.4 THEN 1 + floor({C} * power(random(), 2))::int END AS cust_n,
                    (ARRAY[2, 3, 5])[1 + n % 3] AS nlines
                FROM generate_series({a}, {b}) n)
            SELECT x.*, uuidv7(x.sold_at - clock_timestamp()) AS id, x.n % 100 = 0 AS cancelled FROM x;
        CREATE TEMP TABLE perf_sl AS
            WITH x AS MATERIALIZED (
                SELECT s.id AS sale_id, s.n, s.sold_at, k AS pos,
                    LEAST({V}, 1 + floor({V} * power(random(), 2))::int) AS vn,
                    (1 + floor(random() * 3))::numeric AS q,
                    random() < 0.1 AS disc
                FROM perf_s s CROSS JOIN LATERAL generate_series(1, s.nlines) k),
            y AS (
                SELECT x.*, v.id AS variant_id, v.pname, v.opt, v.sku, v.price, v.cost, v.rate,
                    round(x.q * v.price, 2) AS lsub,
                    CASE WHEN x.disc THEN round(round(x.q * v.price, 2) * 0.05, 2) ELSE 0 END AS damt
                FROM x JOIN perf_var v ON v.vn = x.vn)
            SELECT y.*, uuidv7(y.sold_at - clock_timestamp()) AS id, y.lsub - y.damt AS net,
                round((y.lsub - y.damt) * y.rate / 100, 2) AS tax,
                (y.lsub - y.damt) + round((y.lsub - y.damt) * y.rate / 100, 2) AS total,
                round(y.q * y.cost, 2) AS cost_total
            FROM y;
        CREATE INDEX ON perf_sl (sale_id);
        ANALYZE perf_s; ANALYZE perf_sl;
        INSERT INTO sales (id, organization_id, branch_id, store_id, number, customer_id, status, tax_mode, currency, subtotal, item_discount_total,
                invoice_discount_total, tax_total, total, paid_total, change_total, due_total, cost_total, sold_at, created_by,
                cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at)
            SELECT s.id, '{o}'::uuid, b.branch_id, b.store_id, 'INV-' || b.code || '-' || lpad(s.n::text, 7, '0'), c.id,
                CASE WHEN s.cancelled THEN 'cancelled' ELSE 'completed' END, 'exclusive', '{cur}', a.sub, a.disc, 0, a.tax, a.total,
                CASE WHEN c.id IS NOT NULL AND s.n % 25 = 0 THEN 0 ELSE a.total END, 0,
                CASE WHEN c.id IS NOT NULL AND s.n % 25 = 0 THEN a.total ELSE 0 END, a.cost, s.sold_at, u.user_id,
                CASE WHEN s.cancelled THEN s.sold_at + interval '10 minutes' END, CASE WHEN s.cancelled THEN u.user_id END,
                CASE WHEN s.cancelled THEN 'Entered by mistake' END, s.sold_at, s.sold_at
            FROM perf_s s
            JOIN (SELECT sale_id, sum(lsub) AS sub, sum(damt) AS disc, sum(tax) AS tax, sum(total) AS total, sum(cost_total) AS cost FROM perf_sl GROUP BY sale_id) a ON a.sale_id = s.id
            JOIN perf_br b ON b.i = s.bi JOIN perf_cashier u ON u.bi = s.bi AND u.k = s.ck LEFT JOIN perf_cust c ON c.n = s.cust_n
            ORDER BY s.sold_at;
        INSERT INTO sale_lines (id, organization_id, sale_id, position, variant_id, product_name, variant_name, sku, unit_code, quantity, unit_price,
                discount_type, discount_value, line_subtotal, discount_amount, invoice_discount_share, net_amount, tax_rate, tax_amount, line_total,
                unit_cost, cost_total, created_at)
            SELECT l.id, '{o}'::uuid, l.sale_id, l.pos, l.variant_id, l.pname, l.opt, l.sku, 'pcs', l.q, l.price,
                CASE WHEN l.disc THEN 'percent' END, CASE WHEN l.disc THEN 5 END, l.lsub, l.damt, 0, l.net, l.rate, l.tax, l.total,
                l.cost, l.cost_total, l.sold_at
            FROM perf_sl l ORDER BY l.sold_at, l.pos;
        INSERT INTO sale_payments (id, organization_id, sale_id, branch_id, kind, method, amount, created_by, created_at)
            SELECT uuidv7(s.sold_at - clock_timestamp()), '{o}'::uuid, s.id, s.branch_id, 'payment', (ARRAY['cash','card','mobile_banking'])[1 + p.n % 3],
                s.paid_total, s.created_by, s.sold_at
            FROM perf_s p JOIN sales s ON s.id = p.id WHERE s.paid_total > 0
            UNION ALL
            SELECT uuidv7(s.cancelled_at - clock_timestamp()), '{o}'::uuid, s.id, s.branch_id, 'reversal', (ARRAY['cash','card','mobile_banking'])[1 + p.n % 3],
                -s.paid_total, s.cancelled_by, s.cancelled_at
            FROM perf_s p JOIN sales s ON s.id = p.id WHERE s.paid_total > 0 AND p.cancelled;
        INSERT INTO payments (id, organization_id, branch_id, direction, method, currency, amount, source_type, source_id, source_number, customer_id, created_by, created_at)
            SELECT uuidv7(s.sold_at - clock_timestamp()), '{o}'::uuid, s.branch_id, 'in', (ARRAY['cash','card','mobile_banking'])[1 + p.n % 3], '{cur}',
                s.paid_total, 'sale', s.id, s.number, s.customer_id, s.created_by, s.sold_at
            FROM perf_s p JOIN sales s ON s.id = p.id WHERE s.paid_total > 0
            UNION ALL
            SELECT uuidv7(s.cancelled_at - clock_timestamp()), '{o}'::uuid, s.branch_id, 'out', (ARRAY['cash','card','mobile_banking'])[1 + p.n % 3], '{cur}',
                s.paid_total, 'sale_cancellation', s.id, s.number, s.customer_id, s.cancelled_by, s.cancelled_at
            FROM perf_s p JOIN sales s ON s.id = p.id WHERE s.paid_total > 0 AND p.cancelled;
        INSERT INTO stock_movements (id, organization_id, branch_id, store_id, variant_id, type, quantity, unit_cost, balance_after,
                reference_type, reference_id, reference_number, created_by, created_at)
            SELECT uuidv7(l.sold_at - clock_timestamp()), '{o}'::uuid, s.branch_id, s.store_id, l.variant_id, 'sale', -l.q, l.cost, 50,
                'sale', s.id, s.number, s.created_by, l.sold_at
            FROM perf_sl l JOIN sales s ON s.id = l.sale_id
            UNION ALL
            SELECT uuidv7(s.cancelled_at - clock_timestamp()), '{o}'::uuid, s.branch_id, s.store_id, l.variant_id, 'sale_cancellation', l.q, l.cost, 50,
                'sale', s.id, s.number, s.cancelled_by, s.cancelled_at
            FROM perf_sl l JOIN sales s ON s.id = l.sale_id WHERE s.status = 'cancelled';
        INSERT INTO sale_returns (id, organization_id, branch_id, store_id, sale_id, customer_id, number, status, currency, subtotal, tax_total, total,
                credited_total, refunded_total, requested_by, requested_at, decided_by, decided_at, created_at, updated_at)
            SELECT uuidv7(LEAST(s.sold_at + interval '1 day', now()) - clock_timestamp()), '{o}'::uuid, s.branch_id, s.store_id, s.id, s.customer_id,
                'RET-' || substr(s.number, 5), 'completed', '{cur}', l.net, l.tax, l.total, 0, l.total, s.created_by, LEAST(s.sold_at + interval '1 day', now()),
                s.created_by, LEAST(s.sold_at + interval '1 day', now()), LEAST(s.sold_at + interval '1 day', now()), LEAST(s.sold_at + interval '1 day', now())
            FROM perf_s p JOIN sales s ON s.id = p.id JOIN perf_sl l ON l.sale_id = p.id AND l.pos = 1
            WHERE p.n % 200 = 1 AND NOT p.cancelled;
        INSERT INTO sale_return_lines (id, organization_id, sale_return_id, sale_line_id, variant_id, quantity, restock, net_amount, tax_amount, line_total,
                unit_cost, cost_total, created_at)
            SELECT uuidv7(r.decided_at - clock_timestamp()), '{o}'::uuid, r.id, l.id, l.variant_id, l.q, true, l.net, l.tax, l.total, l.cost, l.cost_total, r.decided_at
            FROM perf_s p JOIN sale_returns r ON r.sale_id = p.id JOIN perf_sl l ON l.sale_id = p.id AND l.pos = 1
            WHERE p.n % 200 = 1 AND NOT p.cancelled;
        INSERT INTO stock_movements (id, organization_id, branch_id, store_id, variant_id, type, quantity, unit_cost, balance_after,
                reference_type, reference_id, reference_number, created_by, created_at)
            SELECT uuidv7(r.decided_at - clock_timestamp()), '{o}'::uuid, r.branch_id, r.store_id, rl.variant_id, 'sale_return', rl.quantity, rl.unit_cost, 50,
                'sale_return', r.id, r.number, r.decided_by, r.decided_at
            FROM perf_s p JOIN sale_returns r ON r.sale_id = p.id JOIN sale_return_lines rl ON rl.sale_return_id = r.id
            WHERE p.n % 200 = 1;
        SQL;

    private const ORDERS_CHUNK_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_o, perf_ol;
        CREATE TEMP TABLE perf_o AS
            WITH x AS MATERIALIZED (
                SELECT n,
                    LEAST(timestamptz '{start}' + ((n - 1)::float8 / {O}) * interval '{days} days' + random() * interval '20 hours', now() - interval '5 minutes') AS placed_at,
                    CASE WHEN n % 10 < 7 THEN LEAST({CA}, 1 + floor({CA} * power(random(), 2))::int) END AS cust_n,
                    1 + n % 4 AS nlines,
                    n % 5 = 0 AS bank
                FROM generate_series({a}, {b}) n)
            SELECT x.*, uuidv7(x.placed_at - clock_timestamp()) AS id,
                CASE WHEN x.placed_at < now() - interval '14 days' THEN (CASE WHEN x.n % 20 = 0 THEN 'cancelled' ELSE 'delivered' END)
                     ELSE (ARRAY['pending_payment','confirmed','processing','shipped','delivered','cancelled'])[1 + x.n % 6] END AS status
            FROM x;
        CREATE TEMP TABLE perf_ol AS
            WITH x AS MATERIALIZED (
                SELECT o.id AS order_id, o.n, o.placed_at, k AS pos,
                    LEAST({LV}, 1 + floor({LV} * power(random(), 2))::int) AS ln,
                    (1 + floor(random() * 2))::numeric AS q
                FROM perf_o o CROSS JOIN LATERAL generate_series(1, o.nlines) k)
            SELECT x.*, uuidv7(x.placed_at - clock_timestamp()) AS id, v.id AS variant_id, v.product_id, v.pn, v.pname, v.opt, v.sku, v.price, v.cost, v.rate,
                round(x.q * v.price, 2) AS lsub, round(round(x.q * v.price, 2) * v.rate / 100, 2) AS tax, round(x.q * v.cost, 2) AS cost_total
            FROM x JOIN perf_lv v ON v.ln = x.ln;
        ANALYZE perf_o; ANALYZE perf_ol;
        INSERT INTO orders (id, organization_id, number, customer_id, customer_account_id, branch_id, store_id, status, payment_status, payment_method,
                shipping_method_name, eta_min_days, eta_max_days, currency, tax_mode, subtotal, tax_total, shipping_total, cod_fee, total, paid_total, cost_total,
                contact_name, contact_email, contact_phone, access_token_hash, placed_at, confirmed_at, shipped_at, delivered_at, cancelled_at, cancel_reason,
                ip, user_agent, created_at, updated_at, discount_total, shipping_discount, refunded_total, locale, source)
            SELECT z.id, '{o}'::uuid, 'WEB-' || lpad(z.n::text, 7, '0'), c.id, ca.id, b.branch_id, b.store_id, z.status,
                CASE WHEN z.paid THEN 'paid' ELSE 'unpaid' END, CASE WHEN z.bank THEN 'bank_transfer' ELSE 'cod' END,
                CASE WHEN z.n % 3 = 0 THEN 'Outside Dhaka' ELSE 'Inside Dhaka' END, CASE WHEN z.n % 3 = 0 THEN 3 ELSE 1 END, CASE WHEN z.n % 3 = 0 THEN 5 ELSE 2 END,
                '{cur}', 'exclusive', a.sub, a.tax, z.ship, z.cod, a.sub + a.tax + z.ship + z.cod,
                CASE WHEN z.paid THEN a.sub + a.tax + z.ship + z.cod ELSE 0 END, a.cost,
                COALESCE(c.name, 'Guest ' || z.n), COALESCE(c.email, 'guest' || z.n || '@{tag}.perf.test'), COALESCE(c.phone, '019' || lpad(z.n::text, 8, '0')),
                CASE WHEN c.id IS NULL THEN encode(sha256(('perf' || z.n)::bytea), 'hex') END,
                z.placed_at,
                CASE WHEN z.status NOT IN ('pending_payment', 'cancelled') THEN z.placed_at + interval '1 hour' END,
                CASE WHEN z.status IN ('shipped', 'delivered') THEN LEAST(z.placed_at + interval '1 day', now()) END,
                CASE WHEN z.status = 'delivered' THEN LEAST(z.placed_at + interval '3 days', now()) END,
                CASE WHEN z.status = 'cancelled' THEN z.placed_at + interval '2 hours' END,
                CASE WHEN z.status = 'cancelled' THEN 'Customer asked to cancel' END,
                '103.4.' || (z.n % 250) || '.' || (z.n % 200), 'Mozilla/5.0 (Linux; Android 14) Mobile', z.placed_at, z.placed_at, 0, 0, 0,
                CASE WHEN z.n % 4 = 0 THEN 'bn' ELSE 'en' END, 'storefront'
            FROM (SELECT o.*, CASE WHEN o.n % 3 = 0 THEN 120 ELSE 60 END AS ship, CASE WHEN o.bank THEN 0 ELSE 10 END AS cod,
                    (o.status = 'delivered' OR (o.bank AND o.status IN ('confirmed', 'processing', 'shipped'))) AS paid FROM perf_o o) z
            JOIN (SELECT order_id, sum(lsub) AS sub, sum(tax) AS tax, sum(cost_total) AS cost FROM perf_ol GROUP BY order_id) a ON a.order_id = z.id
            JOIN perf_br b ON b.i = 1 LEFT JOIN perf_cust c ON c.n = z.cust_n LEFT JOIN customer_accounts ca ON ca.customer_id = c.id
            ORDER BY z.placed_at;
        INSERT INTO order_lines (id, organization_id, order_id, position, product_id, variant_id, product_name, variant_name, product_slug, sku, option_values,
                quantity, unit_price, line_subtotal, net_amount, tax_rate, tax_amount, line_total, unit_cost, cost_total, created_at, discount_amount)
            SELECT l.id, '{o}'::uuid, l.order_id, l.pos, l.product_id, l.variant_id, l.pname, l.opt, 'p-' || l.pn, l.sku,
                CASE WHEN l.opt IS NOT NULL THEN json_build_object('Size', l.opt) END,
                l.q, l.price, l.lsub, l.lsub, l.rate, l.tax, l.lsub + l.tax, l.cost, l.cost_total, l.placed_at, 0
            FROM perf_ol l ORDER BY l.placed_at, l.pos;
        INSERT INTO order_addresses (id, organization_id, order_id, kind, recipient_name, phone, email, division_id, division_name, district_id, district_name,
                area, address_line, postcode, created_at)
            SELECT uuidv7(o.placed_at - clock_timestamp()), '{o}'::uuid, o.id, 'shipping', o.contact_name, o.contact_phone, o.contact_email, 3, 'Dhaka',
                1 + p.n % 64, 'District ' || (1 + p.n % 64), 'Area ' || (p.n % 50), 'House ' || p.n || ', Road ' || (p.n % 30), lpad((1000 + p.n % 8000)::text, 4, '0'), o.placed_at
            FROM perf_o p JOIN orders o ON o.id = p.id;
        INSERT INTO stock_movements (id, organization_id, branch_id, store_id, variant_id, type, quantity, unit_cost, balance_after,
                reference_type, reference_id, reference_number, created_by, created_at)
            SELECT uuidv7(l.placed_at - clock_timestamp()), '{o}'::uuid, o.branch_id, o.store_id, l.variant_id, 'online_order', -l.q, l.cost, 50,
                'online_order', o.id, o.number, NULL, l.placed_at
            FROM perf_ol l JOIN orders o ON o.id = l.order_id
            UNION ALL
            SELECT uuidv7(o.cancelled_at - clock_timestamp()), '{o}'::uuid, o.branch_id, o.store_id, l.variant_id, 'online_order_cancel', l.q, l.cost, 50,
                'online_order', o.id, o.number, '{admin}'::uuid, o.cancelled_at
            FROM perf_ol l JOIN orders o ON o.id = l.order_id WHERE o.status = 'cancelled';
        INSERT INTO payments (id, organization_id, branch_id, direction, method, currency, amount, source_type, source_id, source_number, customer_id, created_by, created_at)
            SELECT uuidv7(COALESCE(o.delivered_at, o.confirmed_at) - clock_timestamp()), '{o}'::uuid, o.branch_id, 'in',
                CASE WHEN o.payment_method = 'cod' THEN 'cash_on_delivery' ELSE 'bank_transfer' END, '{cur}', o.paid_total, 'online_order', o.id, o.number,
                o.customer_id, '{admin}'::uuid, COALESCE(o.delivered_at, o.confirmed_at)
            FROM perf_o p JOIN orders o ON o.id = p.id WHERE o.paid_total > 0;
        SQL;

    private const PURCHASING_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_sup, perf_po;
        CREATE TEMP TABLE perf_sup AS SELECT g AS i, uuidv7() AS id FROM generate_series(1, {NS}) g;
        INSERT INTO suppliers (id, organization_id, code, name, phone, email, payment_terms_days, opening_balance, is_active, created_by, created_at, updated_at)
            SELECT id, '{o}'::uuid, 'SUP-' || lpad(i::text, 5, '0'), 'Supplier ' || i || ' Traders', '0171' || lpad(i::text, 7, '0'), 'supplier' || i || '@{tag}.perf.test',
                30, 0, true, '{admin}'::uuid, timestamptz '{start}' - interval '300 days', timestamptz '{start}' - interval '300 days'
            FROM perf_sup;
        INSERT INTO supplier_products (id, organization_id, supplier_id, variant_id, supplier_sku, unit_cost, pack_size, lead_time_days, is_preferred, is_active, created_at, updated_at)
            SELECT uuidv7(), '{o}'::uuid, s.id, v.id, 'S-' || v.sku, v.cost, 1, 7, true, true, now(), now()
            FROM perf_var v JOIN perf_sup s ON s.i = 1 + v.vn % {NS} WHERE v.vn % 2 = 1;
        CREATE TEMP TABLE perf_po AS
            SELECT g AS n, uuidv7(d::timestamptz - clock_timestamp()) AS id, d, 1 + g % {NB} AS bi, 1 + (g * 31) % {NS} AS si,
                CASE WHEN d < current_date - 30 THEN (CASE WHEN g % 10 = 0 THEN 'cancelled' ELSE 'received' END)
                     ELSE (ARRAY['draft','ordered','partially_received','ordered','pending_approval'])[1 + g % 5] END AS status
            FROM (SELECT g, ((timestamptz '{start}')::date + ((g - 1)::float8 / {PO} * {days})::int) AS d FROM generate_series(1, {PO}) g) x;
        INSERT INTO purchase_orders (id, organization_id, number, supplier_id, branch_id, store_id, status, order_date, expected_date, currency,
                subtotal, tax_total, total, created_by, updated_by, ordered_at, cancelled_at, submitted_by, submitted_at, approval_level, created_at, updated_at)
            SELECT p.id, '{o}'::uuid, 'PO-' || lpad(p.n::text, 6, '0'), s.id, b.branch_id, b.store_id, p.status, p.d, p.d + 7, '{cur}', 0, 0, 0, '{admin}'::uuid, '{admin}'::uuid,
                CASE WHEN p.status NOT IN ('draft', 'pending_approval') THEN p.d::timestamptz + interval '10 hours' END,
                CASE WHEN p.status = 'cancelled' THEN p.d::timestamptz + interval '1 day' END,
                CASE WHEN p.status = 'pending_approval' THEN '{admin}'::uuid END, CASE WHEN p.status = 'pending_approval' THEN p.d::timestamptz + interval '9 hours' END,
                CASE WHEN p.status = 'pending_approval' THEN 'manager' END,
                p.d::timestamptz + interval '9 hours', p.d::timestamptz + interval '9 hours'
            FROM perf_po p JOIN perf_sup s ON s.i = p.si JOIN perf_br b ON b.i = p.bi ORDER BY p.n;
        INSERT INTO purchase_order_lines (id, organization_id, purchase_order_id, variant_id, quantity, unit_cost, tax_rate, line_subtotal, line_tax, line_total,
                received_quantity, sort_order)
            SELECT uuidv7(), '{o}'::uuid, p.id, v.id, q, v.cost, 0, round(q * v.cost, 2), 0, round(q * v.cost, 2),
                CASE p.status WHEN 'received' THEN q WHEN 'partially_received' THEN floor(q / 2) ELSE 0 END, x.line_no - 1
            FROM perf_po p CROSS JOIN LATERAL generate_series(1, 10) x(line_no)
            JOIN perf_var v ON v.vn = 1 + ((p.n::bigint * 10 + x.line_no) * 7919) % {V}
            CROSS JOIN LATERAL (SELECT (24 + ((p.n + x.line_no) * 13) % 96)::numeric AS q) qq;
        UPDATE purchase_orders o SET subtotal = t.s, total = t.s
            FROM (SELECT purchase_order_id, sum(line_subtotal) AS s FROM purchase_order_lines WHERE organization_id = '{o}'::uuid GROUP BY purchase_order_id) t
            WHERE o.id = t.purchase_order_id;
        INSERT INTO stock_movements (id, organization_id, branch_id, store_id, variant_id, type, quantity, unit_cost, balance_after,
                reference_type, reference_id, reference_number, created_by, created_at)
            SELECT uuidv7(ts - clock_timestamp()), '{o}'::uuid, b.branch_id, b.store_id, v.id, 'purchase_receipt', 24 + g % 96, v.cost, 100,
                'goods_receipt', uuidv7(date_trunc('day', ts) - clock_timestamp()), 'GRN-' || lpad((g / 20)::text, 6, '0'), '{admin}'::uuid, ts
            FROM (SELECT g, timestamptz '{start}' + ((g - 1)::float8 / GREATEST({FILL}, 1)) * interval '{days} days' AS ts FROM generate_series(1, {FILL}) g) x
            JOIN perf_br b ON b.i = 1 + (g / 20) % {NB}
            JOIN perf_var v ON v.vn = 1 + (g::bigint * 7919) % {V};
        INSERT INTO expense_categories (id, organization_id, type, name, is_active, created_at, updated_at)
            SELECT uuidv7(), '{o}'::uuid, 'expense', n, true, now(), now() FROM unnest(ARRAY['Rent','Salaries','Utilities','Transport','Marketing']) n;
        INSERT INTO expenses (id, organization_id, branch_id, type, number, expense_category_id, currency, amount, method, occurred_on, created_by, created_at, updated_at)
            SELECT uuidv7(d::timestamptz - clock_timestamp()), '{o}'::uuid, b.branch_id, 'expense', 'EXP-' || lpad(g::text, 6, '0'), c.id, '{cur}',
                500 + (g * 37) % 20000, 'cash', d, '{admin}'::uuid, d::timestamptz + interval '12 hours', d::timestamptz + interval '12 hours'
            FROM (SELECT g, ((timestamptz '{start}')::date + ((g - 1)::float8 / {EXP} * {days})::int) AS d FROM generate_series(1, {EXP}) g) x
            JOIN perf_br b ON b.i = 1 + g % {NB}
            JOIN (SELECT id, row_number() OVER (ORDER BY name) AS i FROM expense_categories WHERE organization_id = '{o}'::uuid) c ON c.i = 1 + g % 5;
        SQL;

    private const HISTORY_SQL = <<<'SQL'
        INSERT INTO audit_logs (id, organization_id, branch_id, user_id, action, subject_type, subject_id, new_values, ip_address, request_id, created_at)
            SELECT uuidv7(ts - clock_timestamp()), '{o}'::uuid, b.branch_id, u.user_id, a.action, a.subject, uuidv7(ts - clock_timestamp()),
                jsonb_build_object('note', 'perf ' || g), '10.0.' || (g % 250) || '.' || (g % 200), md5(g::text), ts
            FROM (SELECT g, timestamptz '{start}' + ((g - 1)::float8 / {AUD}) * interval '{days} days' AS ts FROM generate_series(1, {AUD}) g) x
            JOIN perf_br b ON b.i = 1 + g % {NB}
            JOIN perf_cashier u ON u.bi = 1 + g % {NB} AND u.k = 1 + (g / 7) % 4
            JOIN (VALUES (0, 'register_session.opened', 'cash_register_sessions'), (1, 'register_session.closed', 'cash_register_sessions'),
                         (2, 'web_order.processing', 'orders'), (3, 'web_order.shipped', 'orders'), (4, 'web_order.delivered', 'orders'),
                         (5, 'product.updated', 'products'), (6, 'customer.updated', 'customers'), (7, 'stock_adjustment.posted', 'stock_adjustments'),
                         (8, 'sale.cancelled', 'sales'), (9, 'sale_return.completed', 'sale_returns')) a(i, action, subject) ON a.i = g % 10;
        INSERT INTO login_activities (id, organization_id, user_id, email, channel, succeeded, failure_reason, ip_address, user_agent, created_at)
            SELECT uuidv7(ts - clock_timestamp()), '{o}'::uuid, u.user_id, 'perf-cashier-{tag}-' || u.bi || '-' || u.k || '@perf.test', 'session', g % 20 <> 0,
                CASE WHEN g % 20 = 0 THEN 'invalid_credentials' END, '10.0.' || (g % 250) || '.' || (g % 200), 'Mozilla/5.0 (Windows NT 10.0)', ts
            FROM (SELECT g, timestamptz '{start}' + ((g - 1)::float8 / {LOG}) * interval '{days} days' AS ts FROM generate_series(1, {LOG}) g) x
            JOIN perf_cashier u ON u.bi = 1 + g % {NB} AND u.k = 1 + (g / 3) % 4;
        SQL;

    private const CLEANUP_SQL = <<<'SQL'
        DROP TABLE IF EXISTS perf_br, perf_cashier, perf_tax, perf_grp, perf_cat, perf_leaf, perf_brand, perf_prod, perf_var, perf_lv, perf_cust,
            perf_s, perf_sl, perf_o, perf_ol, perf_sup, perf_po;
        SQL;

    /**
     * @param  array<string, mixed>  $p
     */
    private function sql(string $label, array $p, string $sql): void
    {
        $this->step($label, fn () => $this->run($p, $sql));
    }

    /**
     * Fills the {placeholders} (ids generated here, integers) and runs the statements.
     *
     * @param  array<string, mixed>  $p
     */
    private function run(array $p, string $sql): void
    {
        if (str_contains($sql, '{V}') || str_contains($sql, '{LV}')) {
            $p['V'] ??= (int) DB::selectOne('SELECT count(*) AS c FROM perf_var')->c;
            $p['LV'] ??= max(1, (int) DB::selectOne('SELECT count(*) AS c FROM perf_lv')->c);
        }
        $replace = [];
        foreach ($p as $key => $value) {
            $replace['{'.$key.'}'] = (string) $value;
        }
        DB::unprepared(strtr($sql, $replace));
    }

    private function step(string $label, Closure $work): void
    {
        $started = microtime(true);
        $work();
        ($this->log)(sprintf('  %-48s %7.1f s', $label, microtime(true) - $started));
    }
}
