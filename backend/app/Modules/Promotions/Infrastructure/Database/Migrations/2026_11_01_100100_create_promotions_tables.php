<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Promotions of the online store (E8b, web channel only): automatic offers and coupon
 * offers, their targets, coupon codes and the append-only redemptions written when an
 * order is placed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('promotions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 80);
            // Shown to shoppers, e.g. "10% off juices".
            $table->string('description', 200)->nullable();
            $table->string('type', 20); // percent | fixed | free_shipping
            $table->decimal('value', 18, 2)->default(0);
            $table->string('scope', 20); // order | products | categories | brands
            $table->decimal('min_subtotal', 18, 2)->nullable();
            $table->decimal('max_discount', 18, 2)->nullable();
            $table->string('trigger', 20); // automatic | coupon
            $table->timestampTz('starts_at')->nullable();
            $table->timestampTz('ends_at')->nullable();
            // A "flash sale": automatic, product scope, with an end.
            $table->boolean('show_countdown')->default(false);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('usage_limit')->nullable();
            $table->unsignedInteger('usage_limit_per_customer')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'trigger', 'is_active']);
            $table->index(['organization_id', 'created_at']);
        });

        // Products, categories (sub-categories included at pricing time) or brands of a product-scope promotion.
        Schema::create('promotion_targets', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('promotion_id')->constrained()->cascadeOnDelete();
            $table->string('target_type', 10); // product | category | brand
            $table->uuid('target_id');

            $table->primary(['promotion_id', 'target_type', 'target_id']);
            $table->index(['organization_id', 'target_type', 'target_id']);
        });

        Schema::create('coupons', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('promotion_id')->constrained()->cascadeOnDelete();
            $table->string('code', 40);
            $table->unsignedInteger('usage_limit')->nullable();
            // Projection of the redemptions with this code (updated at placement, under the row lock).
            $table->unsignedInteger('used_count')->default(0);
            $table->boolean('is_active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['promotion_id', 'code']);
        });
        DB::statement('CREATE UNIQUE INDEX coupons_code_unique ON coupons (organization_id, lower(code))');

        // One row per promotion used by a placed order. Append-only; cancelling the order does not free it (E8b).
        Schema::create('promotion_redemptions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('promotion_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('coupon_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->string('order_number', 40);
            $table->foreignUuid('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('customer_account_id')->nullable()->constrained()->nullOnDelete();
            // lower(contact e-mail): per-customer limits of guests are counted by it.
            $table->string('email', 255);
            $table->string('kind', 10); // product | order | shipping
            $table->decimal('amount', 18, 2);
            $table->timestampTz('created_at');

            $table->index(['promotion_id', 'customer_id']);
            $table->index(['promotion_id', 'email']);
            $table->index('order_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE promotions ADD CONSTRAINT promotions_rules_check CHECK (
                    type IN ('percent', 'fixed', 'free_shipping')
                    AND scope IN ('order', 'products', 'categories', 'brands')
                    AND trigger IN ('automatic', 'coupon')
                    AND (type <> 'percent' OR (value > 0 AND value <= 100))
                    AND (type <> 'fixed' OR value > 0)
                    AND (type <> 'free_shipping' OR scope = 'order')
                    AND (NOT show_countdown OR (ends_at IS NOT NULL AND trigger = 'automatic' AND scope <> 'order'))
                    AND (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
                    AND (min_subtotal IS NULL OR min_subtotal >= 0)
                    AND (max_discount IS NULL OR max_discount > 0)
                    AND (usage_limit IS NULL OR usage_limit >= 1)
                    AND (usage_limit_per_customer IS NULL OR usage_limit_per_customer >= 1)
                )
            SQL);
            DB::statement("ALTER TABLE promotion_targets ADD CONSTRAINT promotion_targets_type_check CHECK (target_type IN ('product', 'category', 'brand'))");
            DB::statement("ALTER TABLE coupons ADD CONSTRAINT coupons_rules_check CHECK (code ~ '^[A-Z0-9-]{3,40}$' AND used_count >= 0 AND (usage_limit IS NULL OR usage_limit >= 1))");
            DB::statement("ALTER TABLE promotion_redemptions ADD CONSTRAINT promotion_redemptions_rules_check CHECK (amount >= 0 AND kind IN ('product', 'order', 'shipping'))");
            DB::unprepared(<<<'SQL'
                CREATE FUNCTION prevent_promotion_redemption_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER promotion_redemptions_append_only BEFORE UPDATE OR DELETE ON promotion_redemptions
                    FOR EACH ROW EXECUTE FUNCTION prevent_promotion_redemption_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS promotion_redemptions_append_only ON promotion_redemptions;
                DROP FUNCTION IF EXISTS prevent_promotion_redemption_mutation();
            SQL);
        }

        Schema::dropIfExists('promotion_redemptions');
        Schema::dropIfExists('coupons');
        Schema::dropIfExists('promotion_targets');
        Schema::dropIfExists('promotions');
    }
};
