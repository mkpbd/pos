<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD2b: newsletter campaigns — a subject and a markdown body e-mailed once to the confirmed
 * subscribers. `recipients_count` is fixed when sending starts, `sent_count` grows per chunk.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('newsletter_campaigns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('subject', 150);
            $table->text('body');
            $table->string('status', 10)->default('draft');
            $table->unsignedInteger('recipients_count')->default(0);
            $table->unsignedInteger('sent_count')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('sent_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampsTz();
            $table->index(['organization_id', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE newsletter_campaigns ADD CONSTRAINT newsletter_campaigns_status_check CHECK (status IN ('draft', 'sending', 'sent'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('newsletter_campaigns');
    }
};
