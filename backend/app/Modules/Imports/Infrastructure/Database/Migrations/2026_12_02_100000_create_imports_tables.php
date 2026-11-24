<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ST1: bulk imports — one row per uploaded file with its dry-run and run counts, plus the row
 * errors found (the first `pos.imports.stored_errors` per phase, with the row's original values
 * so staff can fix the file and upload it again).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('imports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            // The active branch when the file was uploaded (audit context of the run).
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 40);
            $table->string('status', 20);
            $table->string('file_name', 255);
            // xlsx | csv; the file is imports/{organization_id}/{id}.{format} on the imports disk.
            $table->string('file_format', 10);
            $table->unsignedBigInteger('file_size');
            $table->jsonb('options');
            $table->unsignedInteger('rows_total')->default(0);
            $table->unsignedInteger('rows_valid')->default(0);
            $table->unsignedInteger('rows_error')->default(0);
            $table->unsignedInteger('to_create')->default(0);
            $table->unsignedInteger('to_update')->default(0);
            $table->unsignedInteger('to_skip')->default(0);
            $table->unsignedInteger('created')->default(0);
            $table->unsignedInteger('updated')->default(0);
            $table->unsignedInteger('skipped')->default(0);
            $table->unsignedInteger('failed_rows')->default(0);
            // Every error message found (dry run + run), including those not stored.
            $table->unsignedInteger('error_count')->default(0);
            // Row numbers that failed the dry run (internal: the run reports only new failures).
            $table->jsonb('error_rows')->nullable();
            $table->string('message', 1000)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('validated_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampTz('file_deleted_at')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'created_at']);
            $table->index(['organization_id', 'type', 'status']);
            $table->index(['finished_at']);
        });

        Schema::create('import_errors', function (Blueprint $table) {
            $table->id();
            $table->foreignUuid('import_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            // validate | run
            $table->string('phase', 10);
            $table->unsignedInteger('row');
            $table->string('column', 64)->nullable();
            $table->string('message', 1000);
            // The row as read from the file (column key → text), for the errors CSV.
            $table->jsonb('values')->nullable();
            $table->timestampTz('created_at');

            $table->index(['import_id', 'phase', 'row']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE imports ADD CONSTRAINT imports_status_check CHECK (status IN ('validating', 'validated', 'importing', 'completed', 'failed', 'cancelled'))");
            DB::statement("ALTER TABLE import_errors ADD CONSTRAINT import_errors_phase_check CHECK (phase IN ('validate', 'run'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('import_errors');
        Schema::dropIfExists('imports');
    }
};
