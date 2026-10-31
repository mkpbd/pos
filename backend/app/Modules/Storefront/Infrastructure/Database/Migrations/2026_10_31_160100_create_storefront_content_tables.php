<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Promotional images with text and links. A slider is a placement with several banners.
        Schema::create('banners', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('placement', 20);
            $table->string('name', 80);
            $table->string('kicker', 60)->nullable();
            $table->string('title', 120)->nullable();
            $table->string('subtitle', 255)->nullable();
            $table->string('link_url', 255)->nullable();
            $table->string('button_label', 40)->nullable();
            $table->string('secondary_link_url', 255)->nullable();
            $table->string('secondary_button_label', 40)->nullable();
            $table->foreignUuid('desktop_media_id')->constrained('media')->restrictOnDelete();
            $table->foreignUuid('mobile_media_id')->nullable()->constrained('media')->restrictOnDelete();
            $table->char('text_color', 7)->default('#ffffff');
            $table->string('text_position', 10)->default('left');
            $table->timestampTz('starts_at')->nullable();
            $table->timestampTz('ends_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'placement', 'is_active', 'sort_order']);
        });

        // Homepage building blocks, rendered in sort order. `config` is validated per type
        // (Domain\SectionType); banners and, later, products/categories are attached as items.
        Schema::create('homepage_sections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('type', 30);
            $table->string('title', 120)->nullable();
            $table->string('subtitle', 255)->nullable();
            $table->jsonb('config')->default('{}');
            $table->boolean('is_enabled')->default(true);
            $table->timestampTz('starts_at')->nullable();
            $table->timestampTz('ends_at')->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'sort_order']);
        });

        Schema::create('homepage_section_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('section_id')->constrained('homepage_sections')->cascadeOnDelete();
            $table->string('item_type', 20);
            $table->uuid('item_id');
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestampsTz();
            $table->unique(['section_id', 'item_type', 'item_id']);
            $table->index(['organization_id', 'item_type', 'item_id']);
        });

        // Menu items can point at records (content pages now; categories and brands later)
        // instead of a typed URL, so links follow renames and disappear with unpublishing.
        Schema::table('menu_items', function (Blueprint $table) {
            $table->uuid('target_id')->nullable()->after('url');
            $table->index(['organization_id', 'type', 'target_id']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE banners ADD CONSTRAINT banners_placement_check CHECK (placement IN ('hero_slider', 'home_promo'))");
            DB::statement("ALTER TABLE banners ADD CONSTRAINT banners_text_position_check CHECK (text_position IN ('left', 'center', 'right'))");
            DB::statement('ALTER TABLE banners ADD CONSTRAINT banners_window_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)');
            DB::statement('ALTER TABLE homepage_sections ADD CONSTRAINT homepage_sections_window_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)');
            DB::statement("ALTER TABLE menu_items ADD CONSTRAINT menu_items_target_check CHECK ((type = 'custom' AND url IS NOT NULL) OR (type <> 'custom' AND target_id IS NOT NULL))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_target_check');
        }
        Schema::table('menu_items', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'type', 'target_id']);
            $table->dropColumn('target_id');
        });
        Schema::dropIfExists('homepage_section_items');
        Schema::dropIfExists('homepage_sections');
        Schema::dropIfExists('banners');
    }
};
