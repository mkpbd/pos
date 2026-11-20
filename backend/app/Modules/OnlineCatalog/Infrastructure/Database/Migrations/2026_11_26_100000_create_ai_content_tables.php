<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AI2a: AI drafts of online store texts, reviewed by staff before anything is saved.
 *
 * - ai_content_batches: one "write drafts" run — the subject kind, what was asked for
 *   (`criteria` {missing: [description|seo|bangla]|null, ids: [subject ids]}), fields, languages,
 *   tone, length, staff notes, progress counts (subjects) and status queued | running | done |
 *   cancelled | budget_stopped. At most one queued / running batch per organization (partial
 *   unique index).
 * - ai_content_drafts: one subject × language of a batch — the proposed texts with the hash of the
 *   text each was based on (`fields` {<field>: {proposed, base_hash}}), the facts the model said
 *   were missing, status pending | approved | rejected | failed | stale, the failure reason and
 *   who reviewed it. `subject_name` is kept for search and for drafts whose subject was deleted.
 *   Pruned after 30 days (online-catalog:prune-ai-drafts). Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE ai_content_batches (
 *     id uuid PRIMARY KEY,
 *     organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 *     created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *     subject varchar(10) NOT NULL CHECK (subject IN ('product', 'category', 'brand')),
 *     criteria jsonb NOT NULL, fields jsonb NOT NULL, languages jsonb NOT NULL,
 *     tone varchar(20) NOT NULL, length varchar(10) NOT NULL, notes text NULL,
 *     total integer NOT NULL DEFAULT 0, done integer NOT NULL DEFAULT 0, failed integer NOT NULL DEFAULT 0,
 *     status varchar(20) NOT NULL DEFAULT 'queued'
 *       CHECK (status IN ('queued', 'running', 'done', 'cancelled', 'budget_stopped')),
 *     created_at timestamptz NULL, updated_at timestamptz NULL
 *   );
 *   CREATE INDEX ai_content_batches_org_created_idx ON ai_content_batches (organization_id, created_at);
 *   CREATE UNIQUE INDEX ai_content_batches_one_active ON ai_content_batches (organization_id)
 *     WHERE status IN ('queued', 'running');
 *   CREATE TABLE ai_content_drafts (
 *     id uuid PRIMARY KEY,
 *     organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 *     batch_id uuid NOT NULL REFERENCES ai_content_batches(id) ON DELETE CASCADE,
 *     subject varchar(10) NOT NULL CHECK (subject IN ('product', 'category', 'brand')),
 *     subject_id uuid NOT NULL, subject_name varchar(255) NOT NULL DEFAULT '',
 *     language varchar(5) NOT NULL,
 *     fields jsonb NOT NULL, missing_info jsonb NULL,
 *     status varchar(20) NOT NULL DEFAULT 'pending'
 *       CHECK (status IN ('pending', 'approved', 'rejected', 'failed', 'stale')),
 *     error varchar(50) NULL,
 *     reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL, reviewed_at timestamptz NULL,
 *     created_at timestamptz NULL, updated_at timestamptz NULL,
 *     CONSTRAINT ai_content_drafts_batch_subject_language_unique UNIQUE (batch_id, subject_id, language)
 *   );
 *   CREATE INDEX ai_content_drafts_org_status_idx ON ai_content_drafts (organization_id, status, created_at);
 *   CREATE INDEX ai_content_drafts_org_subject_idx ON ai_content_drafts (organization_id, subject, subject_id);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_content_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('subject', 10);
            $table->jsonb('criteria');
            $table->jsonb('fields');
            $table->jsonb('languages');
            $table->string('tone', 20);
            $table->string('length', 10);
            $table->text('notes')->nullable();
            $table->integer('total')->default(0);
            $table->integer('done')->default(0);
            $table->integer('failed')->default(0);
            $table->string('status', 20)->default('queued');
            $table->timestampsTz();

            $table->index(['organization_id', 'created_at'], 'ai_content_batches_org_created_idx');
        });
        DB::statement("ALTER TABLE ai_content_batches ADD CONSTRAINT ai_content_batches_subject_check CHECK (subject IN ('product', 'category', 'brand'))");
        DB::statement("ALTER TABLE ai_content_batches ADD CONSTRAINT ai_content_batches_status_check CHECK (status IN ('queued', 'running', 'done', 'cancelled', 'budget_stopped'))");
        DB::statement("CREATE UNIQUE INDEX ai_content_batches_one_active ON ai_content_batches (organization_id) WHERE status IN ('queued', 'running')");

        Schema::create('ai_content_drafts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('batch_id')->constrained('ai_content_batches')->cascadeOnDelete();
            $table->string('subject', 10);
            $table->uuid('subject_id');
            $table->string('subject_name', 255)->default('');
            $table->string('language', 5);
            $table->jsonb('fields');
            $table->jsonb('missing_info')->nullable();
            $table->string('status', 20)->default('pending');
            $table->string('error', 50)->nullable();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('reviewed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['batch_id', 'subject_id', 'language'], 'ai_content_drafts_batch_subject_language_unique');
            $table->index(['organization_id', 'status', 'created_at'], 'ai_content_drafts_org_status_idx');
            $table->index(['organization_id', 'subject', 'subject_id'], 'ai_content_drafts_org_subject_idx');
        });
        DB::statement("ALTER TABLE ai_content_drafts ADD CONSTRAINT ai_content_drafts_subject_check CHECK (subject IN ('product', 'category', 'brand'))");
        DB::statement("ALTER TABLE ai_content_drafts ADD CONSTRAINT ai_content_drafts_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'failed', 'stale'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_content_drafts');
        Schema::dropIfExists('ai_content_batches');
    }
};
