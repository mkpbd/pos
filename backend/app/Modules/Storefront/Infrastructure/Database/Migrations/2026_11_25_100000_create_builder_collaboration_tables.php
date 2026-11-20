<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B16: teamwork in the store builder. Additive only.
 *
 * - builder_comments: comments pinned on a builder document (on a section / element `node_id`
 *   with an `anchor` {x, y} inside it, or on the page), one level of replies (`parent_id`),
 *   mentioned staff (`mentions`, user ids), resolved / reopened, soft-deleted. `number` is the
 *   thread's pin number on its document (replies: null).
 * - builder_edit_sessions: draft saves are not audited one by one; each staff member's saves of a
 *   document are counted in rolling sessions (a gap of more than 15 minutes starts a new one) for
 *   the page's activity log.
 *
 * Presence and the edit lock live in the cache (no table).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_comments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_id')->constrained('builder_documents')->cascadeOnDelete();
            $table->uuid('parent_id')->nullable();
            $table->integer('number')->nullable();
            $table->string('node_id', 64)->nullable();
            $table->jsonb('anchor')->nullable();
            $table->text('body');
            $table->jsonb('mentions')->default('[]');
            $table->foreignUuid('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('edited_at')->nullable();
            $table->timestampTz('resolved_at')->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->softDeletesTz();
            $table->index(['document_id', 'parent_id', 'created_at'], 'builder_comments_doc_idx');
            $table->index(['organization_id', 'created_at'], 'builder_comments_org_idx');
        });
        // After the primary key exists: replies go with their thread.
        Schema::table('builder_comments', function (Blueprint $table) {
            $table->foreign('parent_id')->references('id')->on('builder_comments')->cascadeOnDelete();
        });

        Schema::create('builder_edit_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_id')->constrained('builder_documents')->cascadeOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('started_at');
            $table->timestampTz('ended_at');
            $table->integer('saves')->default(1);
            $table->integer('first_revision')->nullable();
            $table->integer('last_revision')->nullable();
            $table->index(['document_id', 'ended_at'], 'builder_edit_sessions_doc_idx');
            $table->index(['document_id', 'user_id', 'ended_at'], 'builder_edit_sessions_user_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_edit_sessions');
        Schema::dropIfExists('builder_comments');
    }
};
