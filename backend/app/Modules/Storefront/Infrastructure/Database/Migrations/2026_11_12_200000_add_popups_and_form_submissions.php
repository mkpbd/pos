<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B8b: popups & bars and the form builder. Additive only.
 *
 * - builder_documents.active: the on / off switch of a popup document (not versioned; a published,
 *   active popup inside its schedule is live). Other documents keep false.
 * - builder_form_submissions: what visitors sent with a builder `form` element. `document_id` is
 *   not a foreign key on purpose: deleting a page or popup keeps the messages sent through it
 *   (the form title and the field labels are snapshots).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('builder_documents', function (Blueprint $table) {
            $table->boolean('active')->default(false);
        });

        Schema::create('builder_form_submissions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->uuid('document_id');
            $table->string('element_id', 32);
            $table->string('form_title', 160);
            $table->jsonb('fields');
            $table->jsonb('values');
            $table->string('reply_to', 254)->nullable();
            $table->string('locale', 8)->nullable();
            $table->string('page_path', 255)->nullable();
            $table->string('ip', 45)->nullable();
            $table->string('user_agent', 255)->nullable();
            $table->string('status', 20)->default('new');
            $table->timestampTz('read_at')->nullable();
            $table->foreignUuid('read_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();
            $table->index(['organization_id', 'created_at'], 'builder_form_submissions_org_created_idx');
            $table->index(['organization_id', 'document_id', 'element_id'], 'builder_form_submissions_org_form_idx');
            $table->index(['organization_id', 'status'], 'builder_form_submissions_org_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_form_submissions');
        Schema::table('builder_documents', function (Blueprint $table) {
            $table->dropColumn('active');
        });
    }
};
