<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\System\Infrastructure\Performance\PerfDataSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * G1c: `pos:perf:seed` and `pos:perf:explain` at a tiny scale (PostgreSQL only: the seed uses
 * PostgreSQL 18 `uuidv7()` and the explain command `EXPLAIN (ANALYZE, FORMAT JSON)`).
 */
class PerformanceToolsTest extends TestCase
{
    use RefreshDatabase;

    public function test_seed_and_explain_run_at_a_tiny_scale(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL only.');
        }

        $this->assertSame(0, Artisan::call('pos:perf:seed', ['--scale' => '0.0005', '--small' => 1]), Artisan::output());

        $org = DB::table('organizations')->where('slug', 'perf-mart')->value('id');
        $this->assertNotNull($org);
        $this->assertSame(['perf-mart', 'perf-small-1'], DB::table('organizations')->where('slug', 'like', PerfDataSeeder::SLUG_PREFIX.'%')->orderBy('slug')->pluck('slug')->all());
        $this->assertSame(5, DB::table('branches')->where('organization_id', $org)->count());
        $this->assertSame(10, DB::table('stores')->where('organization_id', $org)->count());
        $this->assertSame(300, DB::table('sales')->where('organization_id', $org)->count());
        $this->assertSame(1000, (int) DB::table('sale_lines')->where('organization_id', $org)->count());
        $this->assertGreaterThan(0, DB::table('orders')->where('organization_id', $org)->where('status', 'delivered')->count());
        // Sale totals are the sum of their lines; every completed sale is either paid or due.
        $this->assertSame(0, DB::table('sales as s')->where('s.organization_id', $org)
            ->whereRaw('s.total <> (SELECT sum(l.line_total) FROM sale_lines l WHERE l.sale_id = s.id)')->count());
        $this->assertSame(0, DB::table('sales')->where('organization_id', $org)->whereRaw('paid_total + due_total <> total')->count());
        $this->assertGreaterThan(0, DB::table('product_stats')->where('organization_id', $org)->count());

        // A second run refuses (the data is not appended twice).
        $this->assertSame(1, Artisan::call('pos:perf:seed', ['--scale' => '0.0005']));

        $this->assertSame(0, Artisan::call('pos:perf:explain', ['--runs' => 1, '--threshold' => 0, '--json' => true,
            '--only' => 'dashboard.30d,report.sales_daily.30d,sales.list.filtered,store.products.department,pos.lookup.barcode,web_orders.list']));
        $result = json_decode(Artisan::output(), true);
        $this->assertSame($org, $result['organization_id']);
        $this->assertSame(['dashboard.30d', 'dashboard.30d.branch_manager', 'report.sales_daily.30d', 'sales.list.filtered', 'pos.lookup.barcode', 'store.products.department', 'web_orders.list'],
            array_column($result['results'], 'name'));
        foreach ($result['results'] as $row) {
            $this->assertSame(200, $row['status'], $row['name'].': '.$row['error']);
            $this->assertGreaterThan(0, $row['query_count']);
            $this->assertNotEmpty($row['explained'], $row['name']);
        }
        $plan = $result['results'][0]['explained'][0]['plan'];
        $this->assertArrayHasKey('execution_ms', $plan);
        $this->assertArrayHasKey('seq_scans', $plan);
    }

    public function test_both_commands_refuse_to_run_in_production(): void
    {
        $this->app['env'] = 'production';
        try {
            $this->assertSame(1, Artisan::call('pos:perf:seed', ['--scale' => '0.0005']));
            $this->assertStringContainsString('never runs in production', Artisan::output());
            $this->assertSame(1, Artisan::call('pos:perf:explain'));
            $this->assertStringContainsString('never runs in production', Artisan::output());
        } finally {
            $this->app['env'] = 'testing';
        }
        $this->assertSame(0, DB::table('organizations')->where('slug', 'perf-mart')->count());
    }
}
