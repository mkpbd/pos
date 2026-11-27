<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * R1: claims of the scheduled alerts — one row per kind, subject (organization, store or
 * register session) and organization-local day, so hourly or overlapping runs never send twice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('alert_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('kind', 40);
            $table->uuid('subject_id');
            $table->date('run_on');
            $table->timestampTz('created_at');

            $table->unique(['kind', 'subject_id', 'run_on']);
            $table->index(['organization_id', 'run_on']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE alert_runs ADD CONSTRAINT alert_runs_kind_check CHECK (kind IN ('daily_summary', 'expiry_alert', 'register_open', 'due_reminders'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('alert_runs');
    }
};
