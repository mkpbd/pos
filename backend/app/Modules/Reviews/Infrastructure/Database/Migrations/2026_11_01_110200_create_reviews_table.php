<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Product reviews (E9). Only customers with a delivered order line of the product can review
 * it — `order_line_id` is that line, so every review is a verified purchase. One review per
 * customer and product; staff approve (shown on the product page) or reject it, and an edit
 * by the author sends it back to pending.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('customer_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_line_id')->constrained()->restrictOnDelete();
            $table->smallInteger('rating');
            $table->string('title', 120)->nullable();
            $table->text('body');
            $table->string('status', 10)->default('pending');
            $table->string('rejection_reason', 200)->nullable();
            $table->foreignUuid('moderated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('moderated_at')->nullable();
            $table->timestampsTz();

            $table->unique(['customer_id', 'product_id']);
            $table->index(['organization_id', 'product_id', 'status', 'created_at']);
            $table->index(['organization_id', 'status', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE reviews ADD CONSTRAINT reviews_rules_check CHECK (
                    rating BETWEEN 1 AND 5
                    AND status IN ('pending', 'approved', 'rejected')
                    AND char_length(body) BETWEEN 10 AND 2000
                    AND (title IS NULL OR char_length(title) BETWEEN 1 AND 120)
                    AND (rejection_reason IS NULL OR status = 'rejected')
                    AND ((status = 'pending') = (moderated_at IS NULL))
                )
            SQL);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('reviews');
    }
};
