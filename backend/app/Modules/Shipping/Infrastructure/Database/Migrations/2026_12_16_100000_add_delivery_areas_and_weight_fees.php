<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD2a: merchant-defined delivery areas inside a district (thana / upazila) with a fee
 * adjustment, and per-method weight pricing. Additive only; existing methods keep no
 * weight pricing (weight_included_kg null).
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE shipping_areas (
 *     id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
 *     district_id smallint NOT NULL REFERENCES geo_districts (id) ON DELETE RESTRICT,
 *     name varchar(80) NOT NULL, fee_adjustment numeric(18,2) NOT NULL DEFAULT 0,
 *     is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
 *     created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL, updated_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
 *     created_at timestamptz NULL, updated_at timestamptz NULL);
 *   CREATE UNIQUE INDEX shipping_areas_org_district_name_unique ON shipping_areas (organization_id, district_id, lower(name));
 *   ALTER TABLE shipping_methods
 *     ADD COLUMN weight_included_kg numeric(10,3) NULL,
 *     ADD COLUMN fee_per_extra_kg numeric(18,2) NOT NULL DEFAULT 0,
 *     ADD CONSTRAINT shipping_methods_weight_check CHECK (fee_per_extra_kg >= 0 AND (weight_included_kg IS NULL OR weight_included_kg >= 0));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shipping_areas', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->unsignedSmallInteger('district_id');
            $table->foreign('district_id')->references('id')->on('geo_districts')->restrictOnDelete();
            $table->string('name', 80);
            // May be negative (a cheaper area); the fee never goes below 0.
            $table->decimal('fee_adjustment', 18, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX shipping_areas_org_district_name_unique ON shipping_areas (organization_id, district_id, lower(name))');

        Schema::table('shipping_methods', function (Blueprint $table) {
            $table->decimal('weight_included_kg', 10, 3)->nullable();
            $table->decimal('fee_per_extra_kg', 18, 2)->default(0);
        });
        DB::statement('ALTER TABLE shipping_methods ADD CONSTRAINT shipping_methods_weight_check CHECK (fee_per_extra_kg >= 0 AND (weight_included_kg IS NULL OR weight_included_kg >= 0))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE shipping_methods DROP CONSTRAINT IF EXISTS shipping_methods_weight_check');
        Schema::table('shipping_methods', function (Blueprint $table) {
            $table->dropColumn(['weight_included_kg', 'fee_per_extra_kg']);
        });
        Schema::dropIfExists('shipping_areas');
    }
};
