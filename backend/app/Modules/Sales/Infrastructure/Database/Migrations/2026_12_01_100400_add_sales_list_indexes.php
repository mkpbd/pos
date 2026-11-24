<?php

use App\Modules\Shared\Infrastructure\Persistence\ConcurrentIndex;
use Illuminate\Database\Migrations\Migration;

/**
 * G1c (docs/PERFORMANCE.md), two indexes on `sales`:
 * - the sales list search matches the invoice number with `ILIKE '%…%'`, which scanned every
 *   sale of the organization twice (page and count): a trigram GIN index on `number`
 *   (`pg_trgm` comes from the OnlineCatalog migration, E6);
 * - the newest sales of the organization (dashboard "recent transactions", the sales list's
 *   default order `sold_at DESC, id DESC`) sorted all sales: `(organization_id, sold_at, id)`
 *   is read backwards and stops after a page.
 * Built CONCURRENTLY (checkouts keep writing); the trigram index is PostgreSQL only.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        ConcurrentIndex::create('sales_number_trgm_index', 'sales USING gin (number gin_trgm_ops)');
        ConcurrentIndex::create('sales_org_sold_at_id_index', 'sales (organization_id, sold_at, id)', 'sales (organization_id, sold_at, id)');
    }

    public function down(): void
    {
        ConcurrentIndex::drop('sales_org_sold_at_id_index');
        ConcurrentIndex::drop('sales_number_trgm_index');
    }
};
