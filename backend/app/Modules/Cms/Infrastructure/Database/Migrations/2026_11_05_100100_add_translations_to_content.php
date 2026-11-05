<?php

use App\Modules\Shared\Infrastructure\Persistence\TranslationsColumn;
use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    /** E12b: Bangla translations of pages, FAQ entries and the blog. */
    private const TABLES = ['cms_pages', 'faq_items', 'blog_categories', 'blog_posts'];

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
