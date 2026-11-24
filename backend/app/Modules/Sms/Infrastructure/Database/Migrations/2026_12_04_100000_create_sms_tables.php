<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * BD1a: text messages — the organization's SMS gateway settings (API key encrypted), the
 * message log (order messages, sign-in / checkout codes with the code masked, test messages)
 * and the one-time codes (HMAC of the code only).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sms_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->unique()->constrained()->restrictOnDelete();
            $table->boolean('is_enabled')->default(false);
            $table->string('driver', 10)->default('log');
            $table->text('http_url')->nullable();
            $table->string('http_method', 4)->default('POST');
            $table->string('http_body', 4)->default('form');
            $table->string('param_to', 40)->default('to');
            $table->string('param_message', 40)->default('message');
            $table->string('param_sender', 40)->nullable();
            $table->string('param_api_key', 40)->nullable();
            // Laravel's encrypted cast (APP_KEY); never returned by the API.
            $table->text('api_key')->nullable();
            $table->string('sender_id', 20)->nullable();
            // Non-secret extra request parameters: {name: value}, at most 10.
            $table->jsonb('extra_params')->nullable();
            $table->string('success_contains', 100)->nullable();
            $table->string('phone_format', 10)->default('880');
            $table->unsignedInteger('monthly_limit')->nullable();
            // Order message templates: {order_placed: {enabled, en, bn}, …} over the defaults.
            $table->jsonb('templates')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('sms_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('to_phone', 11);
            $table->string('purpose', 20);
            // One-time codes are stored masked (••••••).
            $table->text('body');
            $table->smallInteger('segments');
            $table->string('encoding', 10);
            $table->string('driver', 10);
            $table->string('status', 10)->default('queued');
            $table->string('error', 255)->nullable();
            $table->smallInteger('provider_status')->nullable();
            $table->string('provider_response', 500)->nullable();
            $table->smallInteger('attempts')->default(0);
            $table->string('dedupe_key', 120)->nullable();
            $table->string('related_type', 30)->nullable();
            $table->uuid('related_id')->nullable();
            $table->timestampTz('sent_at')->nullable();
            $table->timestampsTz();

            $table->index(['organization_id', 'status']);
        });

        Schema::create('sms_otps', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->cascadeOnDelete();
            $table->string('phone', 11);
            $table->string('purpose', 20);
            // HMAC-SHA256 (APP_KEY) of org|phone|purpose|code — never the code itself.
            $table->char('code_hash', 64);
            $table->smallInteger('attempts')->default(0);
            $table->timestampTz('expires_at');
            $table->timestampTz('consumed_at')->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestampTz('created_at');

            $table->index(['organization_id', 'phone', 'purpose', 'created_at']);
            $table->index(['organization_id', 'ip', 'created_at']);
        });

        DB::statement('CREATE INDEX sms_messages_org_created_index ON sms_messages (organization_id, created_at DESC)');
        DB::statement('CREATE UNIQUE INDEX sms_messages_org_dedupe_unique ON sms_messages (organization_id, dedupe_key) WHERE dedupe_key IS NOT NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE sms_settings ADD CONSTRAINT sms_settings_driver_check CHECK (driver IN ('log', 'http'))");
            DB::statement("ALTER TABLE sms_settings ADD CONSTRAINT sms_settings_http_method_check CHECK (http_method IN ('GET', 'POST'))");
            DB::statement("ALTER TABLE sms_settings ADD CONSTRAINT sms_settings_http_body_check CHECK (http_body IN ('form', 'json'))");
            DB::statement("ALTER TABLE sms_settings ADD CONSTRAINT sms_settings_phone_format_check CHECK (phone_format IN ('local', '880', 'plus880'))");
            DB::statement("ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_purpose_check CHECK (purpose IN ('otp', 'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'test'))");
            DB::statement("ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_encoding_check CHECK (encoding IN ('gsm', 'unicode'))");
            DB::statement("ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check CHECK (status IN ('queued', 'sent', 'failed', 'skipped'))");
            DB::statement("ALTER TABLE sms_otps ADD CONSTRAINT sms_otps_purpose_check CHECK (purpose IN ('login', 'checkout', 'verify_phone'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sms_otps');
        Schema::dropIfExists('sms_messages');
        Schema::dropIfExists('sms_settings');
    }
};
