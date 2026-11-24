<?php

use App\Modules\Shared\Infrastructure\Persistence\ConcurrentIndex;
use Illuminate\Database\Migrations\Migration;

/**
 * G1c (EXPLAIN on production-sized data, docs/PERFORMANCE.md): a covering index for the
 * shared sales definition (Reports `SalesFacts`), the dashboard, the P&L, tax and sales reports.
 * Those queries pick a date range of `sales` and then read every line of those sales; with only
 * `(sale_id, position)` PostgreSQL scanned the whole `sale_lines` table (a hash join) even for
 * one day. With the measures in the index the lines are read index-only (the table is
 * append-only, so the visibility map stays set). Built CONCURRENTLY on PostgreSQL: checkouts
 * keep writing lines while it builds. PostgreSQL only (INCLUDE).
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        ConcurrentIndex::create('sale_lines_sale_id_facts_index',
            'sale_lines (sale_id) INCLUDE (variant_id, quantity, discount_amount, invoice_discount_share, net_amount, tax_rate, tax_amount, cost_total)');
    }

    public function down(): void
    {
        ConcurrentIndex::drop('sale_lines_sale_id_facts_index');
    }
};
