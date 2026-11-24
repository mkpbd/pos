<?php

namespace App\Modules\System\Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * G1c (docs/PERFORMANCE.md): the indexes added after EXPLAIN on production-sized data exist on
 * PostgreSQL, are valid (they are built CONCURRENTLY) and have the planned definitions.
 */
class PerformanceIndexesTest extends TestCase
{
    use RefreshDatabase;

    private const EXPECTED = [
        'sale_lines_sale_id_facts_index' => 'ON public.sale_lines USING btree (sale_id) INCLUDE (variant_id, quantity, discount_amount, invoice_discount_share, net_amount, tax_rate, tax_amount, cost_total)',
        'order_lines_order_id_facts_index' => 'ON public.order_lines USING btree (order_id) INCLUDE (product_id, quantity, discount_amount, net_amount, tax_rate, tax_amount, cost_total)',
        'orders_number_trgm_index' => 'ON public.orders USING gin (number gin_trgm_ops)',
        'orders_contact_name_trgm_index' => 'ON public.orders USING gin (contact_name gin_trgm_ops)',
        'orders_contact_phone_trgm_index' => 'ON public.orders USING gin (contact_phone gin_trgm_ops)',
        'orders_contact_email_trgm_index' => 'ON public.orders USING gin (contact_email gin_trgm_ops)',
        'customers_code_trgm_index' => 'ON public.customers USING gin (code gin_trgm_ops)',
        'customers_name_trgm_index' => 'ON public.customers USING gin (name gin_trgm_ops)',
        'customers_phone_trgm_index' => 'ON public.customers USING gin (phone gin_trgm_ops)',
        'customers_email_trgm_index' => 'ON public.customers USING gin (email gin_trgm_ops)',
        'sales_number_trgm_index' => 'ON public.sales USING gin (number gin_trgm_ops)',
        'sales_org_sold_at_id_index' => 'ON public.sales USING btree (organization_id, sold_at, id)',
    ];

    public function test_performance_indexes_exist_on_postgresql(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL only (INCLUDE and trigram indexes).');
        }

        $indexes = collect(DB::select(
            'SELECT c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition, i.indisvalid AS valid
             FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = current_schema() AND c.relname IN ('.implode(', ', array_fill(0, count(self::EXPECTED), '?')).')',
            array_keys(self::EXPECTED),
        ))->keyBy('name');

        $this->assertSame([], array_values(array_diff(array_keys(self::EXPECTED), $indexes->keys()->all())), 'missing indexes');
        $schema = (string) DB::selectOne('SELECT current_schema() AS s')->s;
        foreach (self::EXPECTED as $name => $definition) {
            $this->assertTrue((bool) $indexes[$name]->valid, "{$name} is not valid");
            $this->assertStringContainsString(str_replace('public.', $schema.'.', $definition), $indexes[$name]->definition);
        }
    }
}
