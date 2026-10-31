<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A dictionary of option names ("Size", "Colour") and their values. Products keep
        // their own options/option_values; an option is linked to an attribute when its
        // name matches the attribute name case-insensitively.
        Schema::create('attributes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 60);
            $table->string('slug', 80);
            $table->string('display', 10)->default('button');
            $table->boolean('is_filterable')->default(true);
            $table->integer('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('attribute_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('attribute_id')->constrained('attributes')->cascadeOnDelete();
            $table->string('value', 60);
            $table->char('swatch_hex', 7)->nullable();
            $table->integer('sort_order')->default(0);
            $table->timestampsTz();

            $table->index(['attribute_id', 'sort_order']);
        });

        DB::statement('CREATE UNIQUE INDEX attributes_org_name_unique ON attributes (organization_id, lower(name))');
        DB::statement('CREATE UNIQUE INDEX attributes_org_slug_unique ON attributes (organization_id, lower(slug))');
        DB::statement('CREATE UNIQUE INDEX attribute_values_value_unique ON attribute_values (attribute_id, lower(value))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE attributes ADD CONSTRAINT attributes_display_check CHECK (display IN ('text', 'swatch', 'button'))");
            DB::statement("ALTER TABLE attribute_values ADD CONSTRAINT attribute_values_swatch_check CHECK (swatch_hex IS NULL OR swatch_hex ~ '^#[0-9a-fA-F]{6}$')");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('attribute_values');
        Schema::dropIfExists('attributes');
    }
};
