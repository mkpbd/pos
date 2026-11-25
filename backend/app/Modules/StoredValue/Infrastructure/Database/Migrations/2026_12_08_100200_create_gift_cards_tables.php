<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1b: gift cards (sold at the till), vouchers (issued free by a manager) and credit notes
 * (refunds of returns). The code itself is never stored: only the SHA-256 of the normalised
 * code (upper case, no dashes/spaces) and its last 4 characters. The balance lives on the card
 * row (changed only under a row lock) and every movement is written to the append-only
 * `gift_card_entries`.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE gift_cards (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations,
 *     code_hash char(64) NOT NULL, code_last4 varchar(4) NOT NULL, kind varchar(20) NOT NULL,
 *     initial_value numeric(18,2) NOT NULL, balance numeric(18,2) NOT NULL, currency char(3) NOT NULL,
 *     status varchar(10) NOT NULL DEFAULT 'active', expires_at timestamptz NULL, customer_id uuid NULL REFERENCES customers,
 *     issued_by uuid NULL REFERENCES users ON DELETE SET NULL, issued_at timestamptz NOT NULL,
 *     sale_receipt_number varchar(40) NULL, source_return_id uuid NULL, note varchar(200) NULL,
 *     void_reason varchar(200) NULL, voided_by uuid NULL REFERENCES users ON DELETE SET NULL, voided_at timestamptz NULL,
 *     created_at timestamptz, updated_at timestamptz, UNIQUE (organization_id, code_hash),
 *     CHECK (kind IN ('gift_card', 'voucher', 'credit_note')), CHECK (status IN ('active', 'void')),
 *     CHECK (initial_value > 0), CHECK (balance >= 0));
 *   CREATE TABLE gift_card_entries (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations,
 *     gift_card_id uuid NOT NULL REFERENCES gift_cards, type varchar(20) NOT NULL, amount numeric(18,2) NOT NULL,
 *     balance_after numeric(18,2) NOT NULL, reference_type varchar(30) NULL, reference_id uuid NULL,
 *     reference_number varchar(40) NULL, created_by uuid NULL REFERENCES users ON DELETE SET NULL,
 *     created_at timestamptz NOT NULL, CHECK (type IN ('issue', 'redeem', 'sale_reversal', 'void')),
 *     CHECK (balance_after >= 0), CHECK (amount <> 0 OR type = 'void'));  -- + append-only trigger
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('gift_cards', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->char('code_hash', 64);
            $table->string('code_last4', 4);
            $table->string('kind', 20);
            $table->decimal('initial_value', 18, 2);
            $table->decimal('balance', 18, 2);
            $table->char('currency', 3);
            $table->string('status', 10)->default('active');
            $table->timestampTz('expires_at')->nullable();
            $table->foreignUuid('customer_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('issued_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('issued_at');
            // GCS-000001 when sold at the till.
            $table->string('sale_receipt_number', 40)->nullable();
            // Credit notes: the return they refund (no foreign key: issued inside the return transaction).
            $table->uuid('source_return_id')->nullable();
            $table->string('note', 200)->nullable();
            $table->string('void_reason', 200)->nullable();
            $table->foreignUuid('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('voided_at')->nullable();
            $table->timestampsTz();

            $table->unique(['organization_id', 'code_hash']);
            $table->index(['organization_id', 'code_last4']);
            $table->index(['organization_id', 'issued_at']);
            $table->index('customer_id');
        });

        Schema::create('gift_card_entries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('gift_card_id')->constrained()->restrictOnDelete();
            $table->string('type', 20);
            // Signed: + raises the balance, − lowers it.
            $table->decimal('amount', 18, 2);
            $table->decimal('balance_after', 18, 2);
            // sale | sale_return | gift_card_sale (no foreign key: written inside the caller's transaction).
            $table->string('reference_type', 30)->nullable();
            $table->uuid('reference_id')->nullable();
            $table->string('reference_number', 40)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->index(['gift_card_id', 'created_at']);
            $table->index(['organization_id', 'reference_type', 'reference_id']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_kind_check CHECK (kind IN ('gift_card', 'voucher', 'credit_note'));
                ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check CHECK (status IN ('active', 'void'));
                ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_initial_value_check CHECK (initial_value > 0);
                ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_balance_check CHECK (balance >= 0);
                ALTER TABLE gift_card_entries ADD CONSTRAINT gift_card_entries_type_check CHECK (type IN ('issue', 'redeem', 'sale_reversal', 'void'));
                ALTER TABLE gift_card_entries ADD CONSTRAINT gift_card_entries_balance_check CHECK (balance_after >= 0);
                ALTER TABLE gift_card_entries ADD CONSTRAINT gift_card_entries_amount_check CHECK (amount <> 0 OR type = 'void');

                CREATE OR REPLACE FUNCTION prevent_gift_card_entry_mutation() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;

                CREATE TRIGGER gift_card_entries_append_only BEFORE UPDATE OR DELETE ON gift_card_entries
                    FOR EACH ROW EXECUTE FUNCTION prevent_gift_card_entry_mutation();
            SQL);
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                DROP TRIGGER IF EXISTS gift_card_entries_append_only ON gift_card_entries;
                DROP FUNCTION IF EXISTS prevent_gift_card_entry_mutation();
            SQL);
        }

        Schema::dropIfExists('gift_card_entries');
        Schema::dropIfExists('gift_cards');
    }
};
