<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1d: digital receipts. A sale gets one public receipt link (a random URL-safe token, made on
 * first need and reused) and every receipt sent by SMS or e-mail leaves an append-only delivery
 * row with the recipient masked (never the full phone number or address).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_receipt_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->unique()->constrained('sales')->restrictOnDelete();
            $table->string('token', 48)->unique();
            $table->timestampTz('created_at');
        });

        Schema::create('sale_receipt_deliveries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('sale_id')->constrained('sales')->restrictOnDelete();
            $table->string('channel', 10);
            // e.g. 017••••123 or ra•••@gmail.com — the full recipient is never stored.
            $table->string('recipient_masked', 120);
            // The Sms module's message (no foreign key across modules).
            $table->uuid('sms_message_id')->nullable();
            $table->string('status', 10);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['sale_id', 'created_at']);
        });

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sale_receipt_deliveries ADD CONSTRAINT sale_receipt_deliveries_channel_check CHECK (channel IN ('sms', 'email'));
            ALTER TABLE sale_receipt_deliveries ADD CONSTRAINT sale_receipt_deliveries_status_check CHECK (status IN ('queued', 'skipped', 'failed'));
            ALTER TABLE sale_receipt_links ADD CONSTRAINT sale_receipt_links_token_check CHECK (char_length(token) >= 32);
            CREATE TRIGGER sale_receipt_deliveries_append_only BEFORE UPDATE OR DELETE ON sale_receipt_deliveries
                FOR EACH ROW EXECUTE FUNCTION prevent_sales_mutation();
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP TRIGGER IF EXISTS sale_receipt_deliveries_append_only ON sale_receipt_deliveries;');
        }

        Schema::dropIfExists('sale_receipt_deliveries');
        Schema::dropIfExists('sale_receipt_links');
    }
};
