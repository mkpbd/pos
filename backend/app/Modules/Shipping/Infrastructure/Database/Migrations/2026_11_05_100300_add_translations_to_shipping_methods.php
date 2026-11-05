<?php

use App\Modules\Shared\Infrastructure\Persistence\TranslationsColumn;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /** E12b: Bangla name and description of delivery methods. */
    private const TABLES = ['shipping_methods'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            TranslationsColumn::add($table);
        }
    }

    public function down(): void
    {
        foreach (array_reverse(self::TABLES) as $table) {
            TranslationsColumn::drop($table);
        }
    }
};
