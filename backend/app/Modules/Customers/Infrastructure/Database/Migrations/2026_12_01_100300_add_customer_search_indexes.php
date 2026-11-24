<?php

use App\Modules\Shared\Infrastructure\Persistence\ConcurrentIndex;
use Illuminate\Database\Migrations\Migration;

/**
 * G1c (docs/PERFORMANCE.md): the customer list search (`?search=` on code, name, phone and
 * e-mail, `ILIKE '%…%'`, also used to attach a customer at the till) scanned every customer of
 * the organization for the count. Trigram GIN indexes on the four columns serve it as a
 * BitmapOr. `pg_trgm` comes from the OnlineCatalog migration (E6). Built CONCURRENTLY;
 * PostgreSQL only.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    private const COLUMNS = ['code', 'name', 'phone', 'email'];

    public function up(): void
    {
        foreach (self::COLUMNS as $column) {
            ConcurrentIndex::create("customers_{$column}_trgm_index", "customers USING gin ({$column} gin_trgm_ops)");
        }
    }

    public function down(): void
    {
        foreach (self::COLUMNS as $column) {
            ConcurrentIndex::drop("customers_{$column}_trgm_index");
        }
    }
};
