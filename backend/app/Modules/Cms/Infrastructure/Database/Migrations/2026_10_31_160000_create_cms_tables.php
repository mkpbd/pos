<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Content pages (About, FAQ, Contact, policies). Body is sanitized HTML (ADR-009).
        Schema::create('cms_pages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('slug', 100);
            $table->string('title', 160);
            $table->text('body_html')->nullable();
            $table->string('template', 20)->default('default');
            $table->string('status', 20)->default('draft');
            $table->timestampTz('published_at')->nullable();
            $table->string('seo_title', 160)->nullable();
            $table->string('seo_description', 300)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();
            $table->index(['organization_id', 'status']);
        });

        Schema::create('faq_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('group', 80)->nullable();
            $table->string('question', 255);
            $table->text('answer_html');
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'is_active', 'sort_order']);
        });

        // Messages from the storefront contact form. Never edited; only marked handled.
        Schema::create('contact_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 120);
            $table->string('email', 254);
            $table->string('phone', 20)->nullable();
            $table->string('subject', 160)->nullable();
            $table->text('message');
            $table->string('ip', 45)->nullable();
            $table->timestampTz('handled_at')->nullable();
            $table->foreignUuid('handled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'handled_at', 'created_at']);
        });

        // Double opt-in: pending until the e-mailed link is confirmed. Tokens are stored hashed.
        Schema::create('newsletter_subscribers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('email', 254);
            $table->string('status', 20)->default('pending');
            $table->string('confirm_token_hash', 64)->nullable();
            $table->string('unsubscribe_token_hash', 64)->nullable();
            $table->timestampTz('confirmation_sent_at')->nullable();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampTz('unsubscribed_at')->nullable();
            $table->string('ip', 45)->nullable();
            $table->timestampsTz();
            $table->index(['organization_id', 'status']);
            $table->unique('confirm_token_hash');
            $table->unique('unsubscribe_token_hash');
        });

        // Case-insensitive uniqueness; slugs only among pages that are not deleted.
        DB::statement('CREATE UNIQUE INDEX cms_pages_org_slug_unique ON cms_pages (organization_id, lower(slug)) WHERE deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX newsletter_subscribers_org_email_unique ON newsletter_subscribers (organization_id, lower(email))');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE cms_pages ADD CONSTRAINT cms_pages_template_check CHECK (template IN ('default', 'faq', 'contact'))");
            DB::statement("ALTER TABLE cms_pages ADD CONSTRAINT cms_pages_status_check CHECK (status IN ('draft', 'published'))");
            DB::statement("ALTER TABLE newsletter_subscribers ADD CONSTRAINT newsletter_subscribers_status_check CHECK (status IN ('pending', 'subscribed', 'unsubscribed'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('newsletter_subscribers');
        Schema::dropIfExists('contact_messages');
        Schema::dropIfExists('faq_items');
        Schema::dropIfExists('cms_pages');
    }
};
