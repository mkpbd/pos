<?php

use App\Modules\Shared\Infrastructure\Persistence\TranslationsColumn;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** E12b: Bangla translations of menu labels, banner texts and homepage section texts. */
    private const TABLES = ['menu_items', 'banners', 'homepage_sections'];

    public function up(): void
    {
        // E12b (ADR-011): the store's languages. English is always on; Bangla can be switched
        // off; the default must be an enabled language; Bengali digits are a display choice.
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->boolean('bangla_enabled')->default(true)->after('allow_indexing');
            $table->string('default_locale', 2)->default('en')->after('bangla_enabled');
            $table->boolean('bangla_digits')->default(false)->after('default_locale');
        });
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE storefront_settings ADD CONSTRAINT storefront_settings_default_locale_check CHECK (default_locale IN ('en', 'bn') AND (bangla_enabled OR default_locale = 'en'))");
        }

        foreach (self::TABLES as $table) {
            TranslationsColumn::add($table);
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $table) {
            TranslationsColumn::drop($table);
        }
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE storefront_settings DROP CONSTRAINT IF EXISTS storefront_settings_default_locale_check');
        }
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['bangla_enabled', 'default_locale', 'bangla_digits']);
        });
    }
};
