<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * G1b: install-wide operations data (not tenant-owned) — database backups with their restore
 * checks, and the built-in error log.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_backups', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at')->nullable();
            // running | succeeded | failed
            $table->string('status', 20);
            // Base name only (the folder is config pos.backup.path); never an absolute path.
            $table->string('file_name')->nullable();
            $table->unsignedBigInteger('size_bytes')->nullable();
            $table->char('sha256', 64)->nullable();
            // Sanitised (no password / connection string), at most 2000 characters.
            $table->text('error')->nullable();
            // skipped | succeeded | failed (the optional off-site hook)
            $table->string('offsite_status', 20)->nullable();
            $table->text('offsite_error')->nullable();
            $table->timestampTz('verified_at')->nullable();
            // passed | failed
            $table->string('verify_status', 20)->nullable();
            $table->text('verify_error')->nullable();
            // list | restore
            $table->string('verify_mode', 20)->nullable();
            // schedule | user
            $table->string('triggered_by', 20);
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();
            // Set when retention deleted the file (the row is kept for the history, then pruned).
            $table->timestampTz('file_deleted_at')->nullable();
            $table->timestampsTz();

            $table->index(['status', 'started_at']);
        });

        Schema::create('error_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->char('fingerprint', 64)->unique();
            $table->string('exception_class');
            $table->string('message', 1000);
            // Relative to the application's base path.
            $table->string('file', 500)->nullable();
            $table->unsignedInteger('line')->nullable();
            $table->text('trace')->nullable();
            $table->unsignedBigInteger('occurrences')->default(1);
            $table->timestampTz('first_seen_at');
            $table->timestampTz('last_seen_at');
            $table->string('last_method', 10)->nullable();
            $table->string('last_path', 500)->nullable();
            $table->string('last_request_id', 64)->nullable();
            // No foreign keys: rows are written through their own connection, possibly about a
            // user or organization the failing request created and rolled back.
            $table->uuid('last_user_id')->nullable();
            $table->uuid('last_organization_id')->nullable();
            // open | resolved | ignored
            $table->string('status', 20)->default('open');
            $table->timestampTz('resolved_at')->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('notified_at')->nullable();
            $table->timestampsTz();

            $table->index(['status', 'last_seen_at']);
            $table->index('first_seen_at');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE system_backups ADD CONSTRAINT system_backups_status_check CHECK (status IN ('running', 'succeeded', 'failed'))");
            DB::statement("ALTER TABLE system_backups ADD CONSTRAINT system_backups_offsite_check CHECK (offsite_status IS NULL OR offsite_status IN ('skipped', 'succeeded', 'failed'))");
            DB::statement("ALTER TABLE system_backups ADD CONSTRAINT system_backups_verify_check CHECK (verify_status IS NULL OR verify_status IN ('passed', 'failed'))");
            DB::statement("ALTER TABLE system_backups ADD CONSTRAINT system_backups_verify_mode_check CHECK (verify_mode IS NULL OR verify_mode IN ('list', 'restore'))");
            DB::statement("ALTER TABLE system_backups ADD CONSTRAINT system_backups_trigger_check CHECK (triggered_by IN ('schedule', 'user'))");
            DB::statement("ALTER TABLE error_events ADD CONSTRAINT error_events_status_check CHECK (status IN ('open', 'resolved', 'ignored'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('error_events');
        Schema::dropIfExists('system_backups');
    }
};
