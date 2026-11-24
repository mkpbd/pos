<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1c: the organization's ad pixels and tracking code (one row, created on the first save) —
 * Meta pixel + Conversions API (access token encrypted with APP_KEY, never returned), GA4,
 * TikTok, code pasted into every public shop page, and the last Conversions API result.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tracking_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            $table->string('meta_pixel_id', 20)->nullable();
            $table->boolean('meta_capi_enabled')->default(false);
            // Laravel's encrypted cast (APP_KEY); write-only.
            $table->text('meta_capi_token')->nullable();
            $table->string('meta_test_event_code', 40)->nullable();
            $table->string('ga4_measurement_id', 30)->nullable();
            $table->string('tiktok_pixel_id', 30)->nullable();
            // Raw HTML/JS, only from holders of storefront.custom_html; ≤ 20 000 characters each.
            $table->text('head_code')->nullable();
            $table->text('body_code')->nullable();
            $table->string('capi_last_status', 10)->nullable();
            $table->string('capi_last_error', 200)->nullable();
            $table->timestampTz('capi_last_sent_at')->nullable();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE tracking_settings ADD CONSTRAINT tracking_settings_capi_last_status_check CHECK (capi_last_status IS NULL OR capi_last_status IN ('sent', 'failed'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('tracking_settings');
    }
};
