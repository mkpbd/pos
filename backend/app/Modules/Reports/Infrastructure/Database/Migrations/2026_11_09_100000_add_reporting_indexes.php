<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Phase 7: indexes for the report and dashboard queries (Reports module, read models over other
 * modules' tables — the OnlineCatalog E12a precedent). Each serves an organization-wide range
 * scan the existing (organization_id, branch_id, …) indexes cannot when no branch is chosen,
 * or a date column the reports filter on that had no index. Additive; IF NOT EXISTS on both
 * drivers. EXPLAIN on PostgreSQL with production-sized data is still to be done.
 */
return new class extends Migration
{
    private const INDEXES = [
        // Sales facts: completed sales by sale time, completed returns by completion time.
        'sales_org_status_sold_at_index' => 'sales (organization_id, status, sold_at)',
        'sale_returns_org_status_decided_at_index' => 'sale_returns (organization_id, status, decided_at)',
        // Web orders by delivery time, web refunds by refund time.
        'orders_org_status_delivered_at_index' => 'orders (organization_id, status, delivered_at)',
        'order_returns_org_status_refunded_at_index' => 'order_returns (organization_id, status, refunded_at)',
        // Payment collections over every branch.
        'payments_org_created_at_index' => 'payments (organization_id, created_at)',
        // Purchases and tax by invoice date over every supplier and branch; purchase returns by date.
        'goods_receipts_org_invoice_date_index' => 'goods_receipts (organization_id, invoice_date)',
        'purchase_returns_org_created_at_index' => 'purchase_returns (organization_id, created_at)',
    ];

    public function up(): void
    {
        foreach (self::INDEXES as $name => $definition) {
            DB::statement("CREATE INDEX IF NOT EXISTS {$name} ON {$definition}");
        }
    }

    public function down(): void
    {
        foreach (array_keys(self::INDEXES) as $name) {
            DB::statement("DROP INDEX IF EXISTS {$name}");
        }
    }
};
