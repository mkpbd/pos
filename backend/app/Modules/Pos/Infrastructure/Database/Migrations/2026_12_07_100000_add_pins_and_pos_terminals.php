<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * POS1a: cashier PINs and till devices.
 *
 * - users: `pin_hash` (Hash::make of a 4–6 digit PIN), `pin_set_at`, and the PIN lockout
 *   (`pin_failed_count`, `pin_locked_until`) — separate from the password lockout (G1a).
 * - pos_terminals: a browser set up as a till of one store. The device keeps a random token
 *   in the `pos_terminal` cookie; only its SHA-256 is stored. Revoked tills keep their row.
 * - login_activities: channel `pin` (PIN sign-in at a till) and the till it happened at.
 *
 * Manual SQL (PostgreSQL):
 *   ALTER TABLE users ADD COLUMN pin_hash varchar(255) NULL, ADD COLUMN pin_set_at timestamptz NULL,
 *     ADD COLUMN pin_failed_count smallint NOT NULL DEFAULT 0, ADD COLUMN pin_locked_until timestamptz NULL;
 *   CREATE TABLE pos_terminals (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
 *     store_id uuid NOT NULL REFERENCES stores ON DELETE CASCADE, name varchar(60) NOT NULL, token_hash char(64) NOT NULL UNIQUE,
 *     created_by uuid NULL REFERENCES users ON DELETE SET NULL, last_used_at timestamptz NULL, revoked_at timestamptz NULL,
 *     created_at timestamptz, updated_at timestamptz);
 *   ALTER TABLE login_activities DROP CONSTRAINT login_activities_channel_check,
 *     ADD CONSTRAINT login_activities_channel_check CHECK (channel IN ('session', 'token', 'pin')),
 *     ADD COLUMN pos_terminal_id uuid NULL REFERENCES pos_terminals ON DELETE SET NULL;
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('pin_hash')->nullable();
            $table->timestampTz('pin_set_at')->nullable();
            $table->smallInteger('pin_failed_count')->default(0);
            $table->timestampTz('pin_locked_until')->nullable();
        });

        Schema::create('pos_terminals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('store_id')->constrained()->cascadeOnDelete();
            $table->string('name', 60);
            $table->char('token_hash', 64)->unique();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('revoked_at')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'store_id']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE login_activities DROP CONSTRAINT IF EXISTS login_activities_channel_check');
            DB::statement("ALTER TABLE login_activities ADD CONSTRAINT login_activities_channel_check CHECK (channel IN ('session', 'token', 'pin'))");
        }

        Schema::table('login_activities', function (Blueprint $table) {
            $table->foreignUuid('pos_terminal_id')->nullable()->constrained('pos_terminals')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('login_activities', function (Blueprint $table) {
            $table->dropConstrainedForeignId('pos_terminal_id');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("DELETE FROM login_activities WHERE channel = 'pin'");
            DB::statement('ALTER TABLE login_activities DROP CONSTRAINT IF EXISTS login_activities_channel_check');
            DB::statement("ALTER TABLE login_activities ADD CONSTRAINT login_activities_channel_check CHECK (channel IN ('session', 'token'))");
        }

        Schema::dropIfExists('pos_terminals');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['pin_hash', 'pin_set_at', 'pin_failed_count', 'pin_locked_until']);
        });
    }
};
