<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * E11: the `popup` banner placement with its two settings (used only by popups), and blog
 * menu links — `blog` (the blog index, no target), `blog_category` and `blog_post` (target).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('banners', function (Blueprint $table) {
            $table->unsignedSmallInteger('popup_delay_seconds')->nullable()->after('text_position');
            $table->string('popup_frequency', 20)->nullable()->after('popup_delay_seconds');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE banners DROP CONSTRAINT IF EXISTS banners_placement_check');
            DB::statement("ALTER TABLE banners ADD CONSTRAINT banners_placement_check CHECK (placement IN ('hero_slider', 'home_promo', 'popup'))");
            DB::statement("ALTER TABLE banners ADD CONSTRAINT banners_popup_settings_check CHECK (
                (placement = 'popup' AND popup_delay_seconds BETWEEN 0 AND 60 AND popup_frequency IN ('once_per_session', 'once_per_day', 'once_per_week'))
                OR (placement <> 'popup' AND popup_delay_seconds IS NULL AND popup_frequency IS NULL)
            )");

            DB::statement('ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_target_check');
            DB::statement("ALTER TABLE menu_items ADD CONSTRAINT menu_items_target_check CHECK (
                (type = 'custom' AND url IS NOT NULL)
                OR (type = 'blog' AND target_id IS NULL)
                OR (type NOT IN ('custom', 'blog') AND target_id IS NOT NULL)
            )");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_target_check');
            DB::statement("ALTER TABLE menu_items ADD CONSTRAINT menu_items_target_check CHECK ((type = 'custom' AND url IS NOT NULL) OR (type <> 'custom' AND target_id IS NOT NULL))");
            DB::statement('ALTER TABLE banners DROP CONSTRAINT IF EXISTS banners_popup_settings_check');
            DB::statement('ALTER TABLE banners DROP CONSTRAINT IF EXISTS banners_placement_check');
            DB::statement("ALTER TABLE banners ADD CONSTRAINT banners_placement_check CHECK (placement IN ('hero_slider', 'home_promo'))");
        }
        Schema::table('banners', function (Blueprint $table) {
            $table->dropColumn(['popup_delay_seconds', 'popup_frequency']);
        });
    }
};
