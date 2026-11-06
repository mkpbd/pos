<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Phase 8 (AI1): per-organization AI settings, the usage / audit log of AI requests (no prompts,
 * answers or result rows — a short redacted summary at most) and cached daily / monthly insights.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            // The organization can turn AI off even when the application has it on.
            $table->boolean('enabled')->default(true);
            // NULL = the application default (config ai.monthly_token_budget); 0 = unlimited.
            $table->unsignedBigInteger('monthly_token_budget')->nullable();
            // What may be sent to the provider; AI1 knows only `aggregates` (totals, top-N lists, segment counts).
            $table->string('data_sharing_level', 20)->default('aggregates');
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('ai_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();
            // ask | explain_reorder | insights | daily_insights | customer_insights
            $table->string('feature', 30);
            // Report keys / tools the request used (comma-separated), e.g. "sales_daily,sales_by_product".
            $table->string('intent', 255)->nullable();
            // The validated tool parameters (no free text, no result rows).
            $table->json('params')->nullable();
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->string('model', 100)->nullable();
            // ok | refused | failed
            $table->string('status', 20);
            $table->unsignedInteger('duration_ms')->default(0);
            $table->string('error_code', 50)->nullable();
            // Short redacted description ("2 tool calls, 3 rounds"); never the question or the answer.
            $table->string('summary', 255)->nullable();
            $table->timestampTz('created_at');

            $table->index(['organization_id', 'created_at']);
            $table->index(['organization_id', 'feature', 'created_at']);
        });

        Schema::create('ai_insights', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            // `all` (every branch) or the branch id: part of the unique key (a NULL branch would not be unique).
            $table->string('scope_key', 36);
            $table->foreignUuid('branch_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('period', 10); // daily | monthly
            // The day (daily) or the first day of the month (monthly), organization-local.
            $table->date('period_date');
            // Generated with cost figures (served only to users with products.view_cost).
            $table->boolean('with_cost');
            $table->json('facts');
            $table->text('narrative')->nullable();
            // ok | disabled | unavailable | budget_exceeded | refused
            $table->string('narrative_status', 20);
            $table->string('model', 100)->nullable();
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->timestampTz('generated_at');
            $table->timestampsTz();

            $table->unique(['organization_id', 'scope_key', 'period', 'period_date', 'with_cost'], 'ai_insights_scope_unique');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_period_check CHECK (period IN ('daily', 'monthly'))");
            DB::statement("ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_sharing_check CHECK (data_sharing_level IN ('aggregates'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_insights');
        Schema::dropIfExists('ai_requests');
        Schema::dropIfExists('ai_settings');
    }
};
