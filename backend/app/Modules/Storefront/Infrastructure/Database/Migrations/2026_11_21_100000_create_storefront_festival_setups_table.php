<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B17: one-click festival setups — per organization, occasion and year, the campaign window and
 * the builder drafts the setup made (a landing page, the hero sections it put into the home
 * draft, a bar popup), so a repeat setup rewrites the same drafts instead of adding new ones.
 * Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE storefront_festival_setups (
 *     id uuid PRIMARY KEY,
 *     organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 *     occasion varchar(40) NOT NULL,
 *     year smallint NOT NULL,
 *     starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 *     landing_document_id uuid NULL REFERENCES builder_documents(id) ON DELETE SET NULL,
 *     popup_document_id uuid NULL REFERENCES builder_documents(id) ON DELETE SET NULL,
 *     home_section_ids jsonb NOT NULL DEFAULT '[]',
 *     discount_id uuid NULL,
 *     created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *     updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *     created_at timestamptz NULL, updated_at timestamptz NULL,
 *     CONSTRAINT storefront_festival_setups_org_occasion_year_unique UNIQUE (organization_id, occasion, year)
 *   );
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_festival_setups', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('occasion', 40);
            $table->smallInteger('year');
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');
            $table->foreignUuid('landing_document_id')->nullable()->constrained('builder_documents')->nullOnDelete();
            $table->foreignUuid('popup_document_id')->nullable()->constrained('builder_documents')->nullOnDelete();
            // Ids of the sections the setup put at the top of the home draft (replaced on a repeat setup).
            $table->jsonb('home_section_ids')->default('[]');
            // The promotion written into the discount elements (Promotions module; no foreign key across modules).
            $table->uuid('discount_id')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'occasion', 'year'], 'storefront_festival_setups_org_occasion_year_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_festival_setups');
    }
};
