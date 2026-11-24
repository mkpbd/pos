<?php

use App\Modules\Shared\Infrastructure\Persistence\ConcurrentIndex;
use Illuminate\Database\Migrations\Migration;

/**
 * G1c (docs/PERFORMANCE.md): the staff web-order search (`?search=` on number, contact name,
 * phone and e-mail, `ILIKE '%…%'`) scanned every order of the organization three times per
 * request (list, count, status counts). Trigram GIN indexes on the four columns turn it into a
 * BitmapOr of index scans. `pg_trgm` comes from the OnlineCatalog migration (E6). Built
 * CONCURRENTLY; PostgreSQL only.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    private const COLUMNS = ['number', 'contact_name', 'contact_phone', 'contact_email'];

    public function up(): void
    {
        foreach (self::COLUMNS as $column) {
            ConcurrentIndex::create("orders_{$column}_trgm_index", "orders USING gin ({$column} gin_trgm_ops)");
        }
    }

    public function down(): void
    {
        foreach (self::COLUMNS as $column) {
            ConcurrentIndex::drop("orders_{$column}_trgm_index");
        }
    }
};
