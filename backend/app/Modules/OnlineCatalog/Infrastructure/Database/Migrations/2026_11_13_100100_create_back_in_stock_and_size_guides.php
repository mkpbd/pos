<?php

use App\Modules\Shared\Infrastructure\Persistence\TranslationsColumn;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1a: back-in-stock requests and size guides.
 *
 * - back_in_stock_requests: one open request per variant and e-mail (case-insensitive);
 *   `notified_at` is set when the one-shot e-mail is queued. `site_url` is the storefront
 *   address the shopper used (the link in the e-mail).
 * - size_guides: a measurement table `{columns: [{id, label}], rows: [{id, cells: {col: text}}]}`
 *   with Bangla in `translations` `{bn: {title, intro, note, columns: {col: label}, cells: {row: {col: text}}}}`.
 * - size_guide_categories: a category uses at most one guide (subcategories inherit it).
 * - product_listings.size_guide_id: the product's own guide (NULL = its category's).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('back_in_stock_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('variant_id')->constrained('product_variants')->cascadeOnDelete();
            $table->string('email', 254);
            $table->foreignUuid('customer_account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('locale', 5);
            $table->string('site_url', 255);
            $table->timestampsTz();
            $table->timestampTz('notified_at')->nullable();

            $table->index(['organization_id', 'product_id', 'created_at']);
            $table->index(['variant_id', 'notified_at']);
        });
        DB::statement('CREATE UNIQUE INDEX back_in_stock_requests_open_unique ON back_in_stock_requests (variant_id, lower(email)) WHERE notified_at IS NULL');

        Schema::create('size_guides', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 100);
            $table->string('title', 120);
            $table->text('intro')->nullable();
            $table->jsonb('table');
            $table->text('note')->nullable();
            $table->foreignUuid('image_media_id')->nullable()->constrained('media')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'name']);
        });
        TranslationsColumn::add('size_guides');

        Schema::create('size_guide_categories', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('size_guide_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('category_id')->primary()->constrained()->cascadeOnDelete();
            $table->timestampsTz();

            $table->index('size_guide_id');
        });

        Schema::table('product_listings', function (Blueprint $table) {
            $table->foreignUuid('size_guide_id')->nullable()->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('product_listings', function (Blueprint $table) {
            $table->dropConstrainedForeignId('size_guide_id');
        });
        Schema::dropIfExists('size_guide_categories');
        Schema::dropIfExists('size_guides');
        Schema::dropIfExists('back_in_stock_requests');
    }
};
