<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Couriers of the online store (E10a): who carries the parcels. Names are unique per
 * organization (case-insensitive); the optional tracking URL template contains `{tracking}`,
 * which is replaced by the url-encoded tracking number. Shipments and COD remittances
 * reference couriers with ON DELETE RESTRICT, so a used courier can only be deactivated.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('couriers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 80);
            $table->string('phone', 20)->nullable();
            $table->string('tracking_url_template', 500)->nullable();
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'sort_order']);
        });

        DB::statement('CREATE UNIQUE INDEX couriers_name_unique ON couriers (organization_id, lower(name))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE couriers ADD CONSTRAINT couriers_tracking_template_check CHECK (tracking_url_template IS NULL OR (tracking_url_template LIKE '%{tracking}%' AND (tracking_url_template LIKE 'https://%' OR tracking_url_template LIKE 'http://%')))");
            DB::statement('ALTER TABLE couriers ADD CONSTRAINT couriers_name_check CHECK (length(trim(name)) > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('couriers');
    }
};
