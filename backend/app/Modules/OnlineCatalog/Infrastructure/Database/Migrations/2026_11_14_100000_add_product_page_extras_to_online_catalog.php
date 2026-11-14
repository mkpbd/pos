<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P1b: a richer product page.
 *
 * - product_listings.video_url: a YouTube / Vimeo link (Shared VideoUrl), the gallery's last slide.
 * - product_listings.badges: at most two custom badges `[{text, tone, translations: {bn: {text}}|null}]`.
 * - product_affinities: how often two products were bought together (web orders and POS sales of
 *   the last 180 days, rebuilt nightly by `pos:affinities:compute`): one row per direction, so a
 *   product's "frequently bought together" is one indexed read.
 * - product_affinity_runs: when the nightly job last ran for an organization (its local day).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_listings', function (Blueprint $table) {
            $table->string('video_url', 500)->nullable();
            $table->jsonb('badges')->default('[]');
        });

        Schema::create('product_affinities', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('product_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('related_product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedInteger('score');
            $table->timestampTz('computed_at');

            $table->primary(['product_id', 'related_product_id']);
            $table->index(['organization_id', 'product_id', 'score']);
        });

        Schema::create('product_affinity_runs', function (Blueprint $table) {
            $table->foreignUuid('organization_id')->primary()->constrained()->restrictOnDelete();
            // The organization's local day of the last nightly run (one run per day from 03:00).
            $table->date('local_date');
            $table->unsignedInteger('pairs');
            $table->timestampTz('computed_at');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE product_listings ADD CONSTRAINT product_listings_badges_check CHECK (jsonb_typeof(badges) = 'array' AND jsonb_array_length(badges) <= 2)");
            DB::statement('ALTER TABLE product_affinities ADD CONSTRAINT product_affinities_not_self_check CHECK (product_id <> related_product_id)');
            DB::statement('ALTER TABLE product_affinities ADD CONSTRAINT product_affinities_score_check CHECK (score > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_affinity_runs');
        Schema::dropIfExists('product_affinities');
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE product_listings DROP CONSTRAINT IF EXISTS product_listings_badges_check');
        }
        Schema::table('product_listings', function (Blueprint $table) {
            $table->dropColumn(['video_url', 'badges']);
        });
    }
};
