<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Promotions on web orders (E8b): the goods discount, the waived delivery fee and the
 * coupon code on the order, each line's discount (product discount + share of the order
 * discount, as SaleCalculator allocates it) and an append-only snapshot of the promotions
 * the order used.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->decimal('discount_total', 18, 2)->default(0)->after('subtotal');
            $table->decimal('shipping_discount', 18, 2)->default(0)->after('shipping_total');
            $table->string('coupon_code', 40)->nullable()->after('shipping_discount');
        });

        Schema::table('order_lines', function (Blueprint $table) {
            $table->decimal('discount_amount', 18, 2)->default(0)->after('line_subtotal');
        });

        Schema::create('order_promotions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('order_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('promotion_id')->nullable()->constrained()->nullOnDelete();
            $table->string('name', 80);
            $table->string('kind', 10); // product | order | shipping
            $table->decimal('amount', 18, 2);
            $table->timestampTz('created_at');

            $table->index('order_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_discounts_check CHECK (discount_total >= 0 AND shipping_discount >= 0)');
            DB::statement('ALTER TABLE order_lines ADD CONSTRAINT order_lines_discount_check CHECK (discount_amount >= 0 AND discount_amount <= line_subtotal)');
            DB::statement("ALTER TABLE order_promotions ADD CONSTRAINT order_promotions_rules_check CHECK (amount >= 0 AND kind IN ('product', 'order', 'shipping'))");
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER order_promotions_append_only BEFORE UPDATE OR DELETE ON order_promotions
                    FOR EACH ROW EXECUTE FUNCTION prevent_order_detail_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS order_promotions_append_only ON order_promotions;');
            DB::statement('ALTER TABLE order_lines DROP CONSTRAINT IF EXISTS order_lines_discount_check');
            DB::statement('ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discounts_check');
        }

        Schema::dropIfExists('order_promotions');
        Schema::table('order_lines', function (Blueprint $table) {
            $table->dropColumn('discount_amount');
        });
        Schema::table('orders', function (Blueprint $table) {
            $table->dropColumn(['discount_total', 'shipping_discount', 'coupon_code']);
        });
    }
};
