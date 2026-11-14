<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P2b: social media — settings (sandbox / live, the Meta app with its secret encrypted), the
 * connected Facebook Page + Instagram account (tokens encrypted), posts with one result row per
 * target (Facebook, Instagram) and the catalog feeds for Meta, TikTok and Pinterest.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('social_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            $table->string('mode', 10)->default('sandbox');
            $table->string('meta_app_id', 64)->nullable();
            // Laravel's encrypted cast (APP_KEY); never returned by the API.
            $table->text('meta_app_secret')->nullable();
            $table->string('graph_version', 10)->default('v21.0');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        // One connected Meta account (a Facebook Page and its Instagram business account) per organization.
        Schema::create('social_accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            $table->boolean('sandbox')->default(false);
            $table->string('page_id', 64);
            $table->string('page_name', 255);
            $table->string('page_picture_url', 1000)->nullable();
            // Encrypted: the Page token and every Page the user granted (with their tokens).
            $table->text('page_token');
            $table->text('pages');
            $table->string('instagram_id', 64)->nullable();
            $table->string('instagram_username', 100)->nullable();
            $table->string('instagram_picture_url', 1000)->nullable();
            $table->timestampTz('token_expires_at')->nullable();
            $table->foreignUuid('connected_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('connected_at');
            $table->timestampsTz();
        });

        Schema::create('social_posts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->text('caption');
            $table->jsonb('targets');
            // [{kind: product_image|media, id}] in order.
            $table->jsonb('media');
            $table->string('link_path', 255)->nullable();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->foreignUuid('campaign_id')->nullable()->constrained('campaigns')->nullOnDelete();
            $table->string('status', 25)->default('draft');
            $table->timestampTz('scheduled_at')->nullable();
            $table->timestampTz('publishing_started_at')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'status', 'created_at']);
            // The scheduler looks for due posts across organizations.
            $table->index(['status', 'scheduled_at']);
        });

        Schema::create('social_post_results', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('post_id')->constrained('social_posts')->cascadeOnDelete();
            $table->string('target', 20);
            $table->string('status', 20)->default('pending');
            $table->string('remote_id', 100)->nullable();
            $table->string('permalink', 1000)->nullable();
            $table->string('error_code', 50)->nullable();
            $table->string('error_message', 500)->nullable();
            $table->foreignUuid('short_link_id')->nullable()->constrained('short_links')->nullOnDelete();
            $table->boolean('sandbox')->default(false);
            $table->unsignedInteger('attempts')->default(0);
            $table->timestampTz('claimed_at')->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->timestampsTz();

            $table->unique(['post_id', 'target']);
            $table->index(['status', 'claimed_at']);
        });

        Schema::create('product_feeds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('channel', 20);
            // 64 random hex characters; the feed's URL is its only key.
            $table->string('token', 64)->unique();
            $table->boolean('enabled')->default(false);
            $table->unsignedInteger('item_count')->nullable();
            $table->timestampTz('last_generated_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'channel']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE social_settings ADD CONSTRAINT social_settings_mode_check CHECK (mode IN ('sandbox', 'live'))");
            DB::statement("ALTER TABLE social_posts ADD CONSTRAINT social_posts_status_check CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'partially_published', 'failed'))");
            DB::statement("ALTER TABLE social_posts ADD CONSTRAINT social_posts_scheduled_check CHECK (status <> 'scheduled' OR scheduled_at IS NOT NULL)");
            DB::statement("ALTER TABLE social_post_results ADD CONSTRAINT social_post_results_target_check CHECK (target IN ('facebook', 'instagram'))");
            DB::statement("ALTER TABLE social_post_results ADD CONSTRAINT social_post_results_status_check CHECK (status IN ('pending', 'publishing', 'published', 'failed'))");
            DB::statement("ALTER TABLE product_feeds ADD CONSTRAINT product_feeds_channel_check CHECK (channel IN ('meta', 'tiktok', 'pinterest'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('product_feeds');
        Schema::dropIfExists('social_post_results');
        Schema::dropIfExists('social_posts');
        Schema::dropIfExists('social_accounts');
        Schema::dropIfExists('social_settings');
    }
};
