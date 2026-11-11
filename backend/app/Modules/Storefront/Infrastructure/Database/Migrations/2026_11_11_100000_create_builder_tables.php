<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B1: the visual store builder (docs/ecommerce/STORE_BUILDER_PLAN.md §3). Additive only.
 *
 * - builder_documents: one editable draft per page / header / footer / theme / zone, with an
 *   optimistic-concurrency revision and a pointer to the published version (null = never
 *   published, the storefront keeps its legacy rendering).
 * - builder_versions: immutable published snapshots, numbered per document.
 * - builder_templates: section / page / site templates (organization_id null = built in; B5).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('kind', 20);
            $table->string('key', 120);
            $table->string('title', 160);
            $table->smallInteger('schema_version')->default(1);
            $table->jsonb('draft')->default('{}');
            $table->integer('draft_revision')->default(0);
            $table->timestampTz('draft_updated_at')->nullable();
            $table->foreignUuid('draft_updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('published_version_id')->nullable();
            $table->timestampsTz();
            $table->unique(['organization_id', 'key'], 'builder_documents_org_key_unique');
        });

        Schema::create('builder_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_id')->constrained('builder_documents')->cascadeOnDelete();
            $table->integer('number');
            $table->smallInteger('schema_version')->default(1);
            $table->jsonb('content');
            $table->string('note', 160)->nullable();
            $table->timestampTz('published_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at')->nullable();
            $table->unique(['document_id', 'number'], 'builder_versions_doc_number_unique');
            $table->index(['organization_id', 'document_id'], 'builder_versions_org_doc_idx');
        });

        Schema::table('builder_documents', function (Blueprint $table) {
            $table->foreign('published_version_id', 'builder_documents_published_fk')->references('id')->on('builder_versions')->nullOnDelete();
        });

        Schema::create('builder_templates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('scope', 20);
            $table->string('preset', 20)->nullable();
            $table->string('name', 120);
            $table->uuid('thumbnail_media_id')->nullable();
            $table->jsonb('content');
            $table->timestampsTz();
            $table->index(['organization_id', 'scope'], 'builder_templates_org_scope_idx');
        });
    }

    public function down(): void
    {
        Schema::table('builder_documents', function (Blueprint $table) {
            $table->dropForeign('builder_documents_published_fk');
        });
        Schema::dropIfExists('builder_templates');
        Schema::dropIfExists('builder_versions');
        Schema::dropIfExists('builder_documents');
    }
};
