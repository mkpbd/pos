<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The blog (E11): categories and posts. Bodies are sanitized HTML (ADR-009); a post is
 * visible once published and its publication time has come (a future time schedules it).
 * Slugs are unique per organization, case-insensitively, among rows that are not deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blog_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('name', 80);
            $table->string('slug', 100);
            $table->string('description', 300)->nullable();
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();
            $table->index(['organization_id', 'sort_order']);
        });

        Schema::create('blog_posts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('category_id')->nullable()->constrained('blog_categories')->nullOnDelete();
            $table->string('slug', 100);
            $table->string('title', 160);
            $table->string('excerpt', 300)->nullable();
            $table->text('body_html')->nullable();
            // Soft-deleted posts must not keep an image alive: live posts are protected by the
            // media library's reference check (Cms BlogMediaReferences), so the key nulls out.
            $table->foreignUuid('cover_media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->foreignUuid('author_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('status', 20)->default('draft');
            $table->timestampTz('published_at')->nullable();
            $table->string('seo_title', 70)->nullable();
            $table->string('seo_description', 160)->nullable();
            $table->unsignedSmallInteger('reading_minutes')->default(1);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();
            $table->index(['organization_id', 'status', 'published_at']);
            $table->index(['organization_id', 'category_id']);
        });

        DB::statement('CREATE UNIQUE INDEX blog_categories_org_slug_unique ON blog_categories (organization_id, lower(slug)) WHERE deleted_at IS NULL');
        DB::statement('CREATE UNIQUE INDEX blog_posts_org_slug_unique ON blog_posts (organization_id, lower(slug)) WHERE deleted_at IS NULL');

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE blog_categories ADD CONSTRAINT blog_categories_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')");
            DB::statement('ALTER TABLE blog_categories ADD CONSTRAINT blog_categories_name_check CHECK (length(trim(name)) > 0)');
            DB::statement("ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_check CHECK (status IN ('draft', 'published'))");
            DB::statement("ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')");
            DB::statement('ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_reading_minutes_check CHECK (reading_minutes >= 1)');
            DB::statement("ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_published_at_check CHECK (status = 'draft' OR published_at IS NOT NULL)");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('blog_posts');
        Schema::dropIfExists('blog_categories');
    }
};
