<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P2a: marketing campaigns, short links (`/go/<code>`) and visit counts per day. Visits keep no
 * personal data: a day's unique visitors are counted with a hash of ip + user agent salted with
 * a random value that only lives for that day (the hashes are deleted after two days).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('campaigns', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 120);
            $table->string('slug', 60);
            // Lower-case; orders and visits whose utm_campaign equals it belong to the campaign.
            $table->string('utm_campaign', 100);
            // A `landing:<slug>` store builder page (Storefront), null for none.
            $table->uuid('landing_document_id')->nullable();
            $table->timestampTz('starts_at')->nullable();
            $table->timestampTz('ends_at')->nullable();
            $table->string('status', 10)->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'slug']);
            $table->unique(['organization_id', 'utm_campaign']);
            $table->index(['organization_id', 'status']);
        });

        Schema::create('short_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('code', 32);
            $table->string('target_path', 255);
            $table->foreignUuid('campaign_id')->nullable()->constrained('campaigns')->nullOnDelete();
            $table->string('utm_source', 100)->nullable();
            $table->string('utm_medium', 100)->nullable();
            $table->string('utm_campaign', 100)->nullable();
            $table->string('utm_content', 100)->nullable();
            $table->string('utm_term', 100)->nullable();
            $table->unsignedBigInteger('clicks')->default(0);
            $table->timestampTz('last_clicked_at')->nullable();
            $table->boolean('active')->default(true);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'code']);
            $table->index(['organization_id', 'campaign_id']);
        });

        // One row per organization, day (organization time zone), campaign, short link, landing
        // path, source and medium; `bucket` is the hash of those five (the upsert key).
        Schema::create('campaign_daily_stats', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->date('day');
            $table->char('bucket', 64);
            $table->foreignUuid('campaign_id')->nullable()->constrained('campaigns')->cascadeOnDelete();
            $table->foreignUuid('short_link_id')->nullable()->constrained('short_links')->nullOnDelete();
            $table->string('path', 255)->nullable();
            $table->string('source', 100)->nullable();
            $table->string('medium', 100)->nullable();
            $table->unsignedInteger('visits')->default(0);
            $table->unsignedInteger('unique_visitors')->default(0);
            $table->timestampsTz();

            $table->unique(['organization_id', 'day', 'bucket']);
            $table->index(['organization_id', 'campaign_id', 'day']);
        });

        // Today's (and yesterday's) visitor hashes per bucket, to count unique visitors.
        Schema::create('campaign_visitor_hashes', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->date('day');
            $table->char('bucket', 64);
            $table->char('hash', 64);
            $table->timestampTz('created_at');

            $table->primary(['organization_id', 'day', 'bucket', 'hash']);
            $table->index('day');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN ('active', 'archived'))");
            DB::statement('ALTER TABLE short_links ADD CONSTRAINT short_links_clicks_check CHECK (clicks >= 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('campaign_visitor_hashes');
        Schema::dropIfExists('campaign_daily_stats');
        Schema::dropIfExists('short_links');
        Schema::dropIfExists('campaigns');
    }
};
