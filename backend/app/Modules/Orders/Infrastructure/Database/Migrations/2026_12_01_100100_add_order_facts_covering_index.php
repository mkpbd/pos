<?php

use App\Modules\Shared\Infrastructure\Persistence\ConcurrentIndex;
use Illuminate\Database\Migrations\Migration;

/**
 * G1c (docs/PERFORMANCE.md): the web-order side of the sales facts — delivered orders in a
 * date range, then all their lines, read index-only instead of scanning `order_lines`. Built
 * CONCURRENTLY on PostgreSQL (orders keep being placed). PostgreSQL only (INCLUDE).
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        ConcurrentIndex::create('order_lines_order_id_facts_index',
            'order_lines (order_id) INCLUDE (product_id, quantity, discount_amount, net_amount, tax_rate, tax_amount, cost_total)');
    }

    public function down(): void
    {
        ConcurrentIndex::drop('order_lines_order_id_facts_index');
    }
};
