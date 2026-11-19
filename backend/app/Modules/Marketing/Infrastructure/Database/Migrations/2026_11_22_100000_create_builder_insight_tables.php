<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * B15: what shoppers do on store builder pages — daily aggregate counts only (no events, no
 * personal data), per organization, document, store-local day and device (desktop | tablet |
 * mobile). Upserted with `INSERT … ON CONFLICT … DO UPDATE` (no lost increments) and deleted
 * after 90 days (`marketing:prune-page-insights`). `document_id` is a Storefront builder
 * document (no foreign key across modules, like campaigns.landing_document_id).
 *
 * - builder_page_stats: page views, unique visitors (daily salted hashes, see
 *   builder_visitor_hashes) and how many page views reached 25 / 50 / 75 / 100 % scroll.
 * - builder_section_stats: views (≥ 50 % visible for ≥ 1 s) and clicks per top-level section.
 * - builder_click_cells: clicks per 20 × 20 grid cell of a section (the heat map).
 * - builder_vital_buckets: Web Vitals histograms (LCP / INP in ms, CLS) to compute the 75th
 *   percentile over any range (Marketing\Domain\WebVitals).
 * - builder_visitor_hashes: a day's visitor hashes per page and device (sha256 of the daily salt,
 *   ip and user agent — the P2a scheme), kept two days to count unique visitors.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_page_stats', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->date('day');
            $table->string('device', 10);
            $table->unsignedInteger('views')->default(0);
            $table->unsignedInteger('unique_visitors')->default(0);
            $table->unsignedInteger('scroll_25')->default(0);
            $table->unsignedInteger('scroll_50')->default(0);
            $table->unsignedInteger('scroll_75')->default(0);
            $table->unsignedInteger('scroll_100')->default(0);

            $table->primary(['organization_id', 'document_id', 'day', 'device']);
            $table->index(['organization_id', 'day']);
            $table->index('day');
        });

        Schema::create('builder_section_stats', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->string('node_id', 32);
            $table->date('day');
            $table->string('device', 10);
            $table->unsignedInteger('views')->default(0);
            $table->unsignedInteger('clicks')->default(0);

            $table->primary(['organization_id', 'document_id', 'day', 'device', 'node_id']);
            $table->index('day');
        });

        Schema::create('builder_click_cells', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->string('node_id', 32);
            $table->date('day');
            $table->string('device', 10);
            $table->smallInteger('cx');
            $table->smallInteger('cy');
            $table->unsignedInteger('clicks')->default(0);

            $table->primary(['organization_id', 'document_id', 'day', 'device', 'node_id', 'cx', 'cy']);
            $table->index('day');
        });

        Schema::create('builder_vital_buckets', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->date('day');
            $table->string('device', 10);
            $table->string('metric', 3);
            $table->smallInteger('bucket');
            $table->unsignedInteger('samples')->default(0);

            $table->primary(['organization_id', 'document_id', 'day', 'device', 'metric', 'bucket']);
            $table->index('day');
        });

        Schema::create('builder_visitor_hashes', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->date('day');
            $table->string('device', 10);
            $table->char('hash', 64);

            $table->primary(['organization_id', 'document_id', 'day', 'device', 'hash']);
            $table->index('day');
        });

        if (DB::getDriverName() === 'pgsql') {
            foreach (['builder_page_stats', 'builder_section_stats', 'builder_click_cells', 'builder_vital_buckets', 'builder_visitor_hashes'] as $table) {
                DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_device_check CHECK (device IN ('desktop', 'tablet', 'mobile'))");
            }
            DB::statement('ALTER TABLE builder_click_cells ADD CONSTRAINT builder_click_cells_cell_check CHECK (cx BETWEEN 0 AND 19 AND cy BETWEEN 0 AND 19)');
            DB::statement("ALTER TABLE builder_vital_buckets ADD CONSTRAINT builder_vital_buckets_metric_check CHECK (metric IN ('lcp', 'cls', 'inp'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_visitor_hashes');
        Schema::dropIfExists('builder_vital_buckets');
        Schema::dropIfExists('builder_click_cells');
        Schema::dropIfExists('builder_section_stats');
        Schema::dropIfExists('builder_page_stats');
    }
};
