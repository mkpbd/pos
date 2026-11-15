<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * B11: scheduled publishing, named versions and draft checkpoints, approval. Additive only.
 *
 * - builder_versions: `kind` version (a published snapshot, numbered) | checkpoint (a named,
 *   unpublished snapshot of the draft, no number), an editable `name` and `via` (how a version
 *   went live: manual | scheduled | review; null for checkpoints and older versions).
 * - builder_schedules: "publish later" — a snapshot of the draft (or the theme draft) that goes
 *   live at `publish_at`; one pending schedule per document (partial unique index).
 * - builder_reviews: "submit for review" — a snapshot of the draft waiting for someone who may
 *   publish; one pending review per document (partial unique index).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('builder_versions', function (Blueprint $table) {
            $table->string('kind', 12)->default('version');
            $table->string('name', 80)->nullable();
            $table->string('via', 12)->nullable();
            $table->integer('number')->nullable()->change();
        });

        Schema::create('builder_reviews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_id')->constrained('builder_documents')->cascadeOnDelete();
            $table->string('status', 12);
            $table->string('note', 500)->nullable();
            $table->smallInteger('schema_version')->default(1);
            $table->jsonb('content');
            $table->integer('draft_revision');
            $table->foreignUuid('submitted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('decided_at')->nullable();
            $table->string('comment', 1000)->nullable();
            $table->foreignUuid('version_id')->nullable()->constrained('builder_versions')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'status', 'created_at'], 'builder_reviews_org_status_idx');
            $table->index(['document_id', 'created_at'], 'builder_reviews_doc_idx');
        });

        Schema::create('builder_schedules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_id')->constrained('builder_documents')->cascadeOnDelete();
            $table->string('status', 12);
            $table->timestampTz('publish_at');
            $table->string('note', 160)->nullable();
            $table->smallInteger('schema_version')->default(1);
            $table->jsonb('content');
            $table->integer('draft_revision');
            $table->foreignUuid('review_id')->nullable()->constrained('builder_reviews')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->jsonb('failure')->nullable();
            $table->foreignUuid('version_id')->nullable()->constrained('builder_versions')->nullOnDelete();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();
            $table->index(['status', 'publish_at'], 'builder_schedules_due_idx');
            $table->index(['document_id', 'created_at'], 'builder_schedules_doc_idx');
        });

        DB::statement("CREATE UNIQUE INDEX builder_schedules_one_pending ON builder_schedules (document_id) WHERE status = 'pending'");
        DB::statement("CREATE UNIQUE INDEX builder_reviews_one_pending ON builder_reviews (document_id) WHERE status = 'pending'");
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_schedules');
        Schema::dropIfExists('builder_reviews');
        DB::table('builder_versions')->where('kind', 'checkpoint')->delete();
        Schema::table('builder_versions', function (Blueprint $table) {
            $table->dropColumn(['kind', 'name', 'via']);
            $table->integer('number')->nullable(false)->change();
        });
    }
};
