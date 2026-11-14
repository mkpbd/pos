<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1b: shoppers' questions about a product, answered by staff. Guests may ask (a signed-in
 * shopper's account is linked); the e-mail address is private (the answer e-mail only). Only
 * published questions — always with an answer — show on the product page. `site_url` is the
 * storefront address the shopper used (the link in the answer e-mail); `answer_notified_at`
 * makes that e-mail a one-off.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('product_questions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 80);
            $table->string('email', 254);
            $table->text('question');
            $table->text('answer')->nullable();
            $table->foreignUuid('answered_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('answered_at')->nullable();
            $table->string('status', 10)->default('pending');
            $table->string('locale', 5);
            $table->string('site_url', 255);
            $table->timestampTz('answer_notified_at')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'product_id', 'status', 'answered_at']);
            $table->index(['organization_id', 'status', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE product_questions ADD CONSTRAINT product_questions_rules_check CHECK (
                    status IN ('pending', 'published', 'rejected')
                    AND char_length(name) BETWEEN 1 AND 80
                    AND char_length(question) BETWEEN 1 AND 500
                    AND (answer IS NULL OR char_length(answer) BETWEEN 1 AND 2000)
                    AND (status <> 'published' OR answer IS NOT NULL)
                )
            SQL);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_questions');
    }
};
