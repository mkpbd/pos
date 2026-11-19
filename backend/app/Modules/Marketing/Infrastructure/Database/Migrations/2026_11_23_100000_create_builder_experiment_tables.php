<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * B13: A/B tests of store builder pages — daily aggregate counts per test version (arm A | B),
 * organization, document, store-local day and device, from the B15 beacons that carry `arms`
 * (RecordPageEvents) and add-to-carts that carry `attribution.builder.experiments`. Upserted with
 * `INSERT … ON CONFLICT … DO UPDATE`, deleted after 90 days with the page insights. Orders and
 * revenue per version are read from the orders' attribution (cancellations follow).
 *
 * - builder_experiment_stats: page views (`seq` 0), unique visitors (daily salted hashes, see
 *   builder_experiment_visitor_hashes), views and clicks of the version's sections, page views
 *   with at least one click on them (`clicked_views`, at most one per beacon) and add-to-carts.
 * - builder_experiment_visitor_hashes: a day's visitor hashes per test version and device, kept
 *   two days to count unique visitors (nothing personal: sha256 of the daily salt, ip and agent).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_experiment_stats', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->string('experiment_id', 32);
            $table->char('arm', 1);
            $table->date('day');
            $table->string('device', 10);
            $table->unsignedInteger('views')->default(0);
            $table->unsignedInteger('visitors')->default(0);
            $table->unsignedInteger('section_views')->default(0);
            $table->unsignedInteger('clicks')->default(0);
            $table->unsignedInteger('clicked_views')->default(0);
            $table->unsignedInteger('add_to_carts')->default(0);

            $table->primary(['organization_id', 'document_id', 'experiment_id', 'arm', 'day', 'device']);
            $table->index('day');
        });

        Schema::create('builder_experiment_visitor_hashes', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->uuid('document_id');
            $table->string('experiment_id', 32);
            $table->char('arm', 1);
            $table->date('day');
            $table->string('device', 10);
            $table->char('hash', 64);

            $table->primary(['organization_id', 'document_id', 'experiment_id', 'arm', 'day', 'device', 'hash']);
            $table->index('day');
        });

        if (DB::getDriverName() === 'pgsql') {
            foreach (['builder_experiment_stats', 'builder_experiment_visitor_hashes'] as $table) {
                DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_device_check CHECK (device IN ('desktop', 'tablet', 'mobile'))");
                DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_arm_check CHECK (arm IN ('A', 'B'))");
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_experiment_visitor_hashes');
        Schema::dropIfExists('builder_experiment_stats');
    }
};
