<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1a: what a sale was charged and why, frozen on the invoice.
 *
 * - sale_lines: `list_price` (catalog price at the time; NULL for open-price products),
 *   `price_source` (catalog | override | open), who approved a changed price and with which
 *   till approval, and the promotion discount of the line (part of `discount_amount`) with
 *   the promotion's name.
 * - sales: the applied coupon code and who approved the manual discounts.
 *   `invoice_discount_source` gains `promotion` (an order promotion or coupon).
 * - sale_promotions: the promotions a sale used (append-only), like order_promotions.
 *
 * Additive only; existing lines read as catalog-priced without promotions.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE sale_lines ADD COLUMN list_price numeric(18,2) NULL,
 *       ADD COLUMN price_source varchar(10) NOT NULL DEFAULT 'catalog',
 *       ADD COLUMN price_approved_by uuid NULL REFERENCES users (id) ON DELETE RESTRICT,
 *       ADD COLUMN price_approval_id uuid NULL,
 *       ADD COLUMN promotion_discount numeric(18,2) NOT NULL DEFAULT 0,
 *       ADD COLUMN promotion_name varchar(80) NULL;
 *   ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_price_source_check CHECK (price_source IN ('catalog', 'override', 'open')
 *       AND promotion_discount >= 0 AND promotion_discount <= discount_amount);
 *   ALTER TABLE sales ADD COLUMN coupon_code varchar(40) NULL,
 *       ADD COLUMN discount_approved_by uuid NULL REFERENCES users (id) ON DELETE SET NULL;
 *   CREATE TABLE sale_promotions (...); -- see up()
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_lines', function (Blueprint $table) {
            $table->decimal('list_price', 18, 2)->nullable();
            $table->string('price_source', 10)->default('catalog');
            $table->foreignUuid('price_approved_by')->nullable()->constrained('users')->restrictOnDelete();
            $table->uuid('price_approval_id')->nullable();
            $table->decimal('promotion_discount', 18, 2)->default(0);
            $table->string('promotion_name', 80)->nullable();
        });

        Schema::table('sales', function (Blueprint $table) {
            $table->string('coupon_code', 40)->nullable();
            $table->foreignUuid('discount_approved_by')->nullable()->constrained('users')->nullOnDelete();
        });

        Schema::create('sale_promotions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->constrained()->restrictOnDelete();
            // Redemptions keep a used promotion from being deleted.
            $table->foreignUuid('promotion_id')->constrained()->restrictOnDelete();
            $table->string('name', 80);
            $table->string('kind', 10); // product | order
            $table->decimal('amount', 18, 2);
            $table->timestampTz('created_at');

            $table->index('sale_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_price_source_check CHECK (price_source IN ('catalog', 'override', 'open') AND promotion_discount >= 0 AND promotion_discount <= discount_amount)");
            DB::statement("ALTER TABLE sale_promotions ADD CONSTRAINT sale_promotions_rules_check CHECK (amount >= 0 AND kind IN ('product', 'order'))");
            DB::unprepared(<<<'SQL'
                CREATE TRIGGER sale_promotions_append_only BEFORE UPDATE OR DELETE ON sale_promotions
                    FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS sale_promotions_append_only ON sale_promotions;');
            DB::statement('ALTER TABLE sale_lines DROP CONSTRAINT IF EXISTS sale_lines_price_source_check');
        }

        Schema::dropIfExists('sale_promotions');
        Schema::table('sales', function (Blueprint $table) {
            $table->dropConstrainedForeignId('discount_approved_by');
            $table->dropColumn('coupon_code');
        });
        Schema::table('sale_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('price_approved_by');
            $table->dropColumn(['list_price', 'price_source', 'price_approval_id', 'promotion_discount', 'promotion_name']);
        });
    }
};
