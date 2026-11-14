<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B10: an organization's own fonts for the storefront theme (WOFF2, at most 4 per
 * organization, ≤ 500 KB each). The theme refers to one as `custom:<id>`. Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE storefront_fonts (
 *     id uuid PRIMARY KEY,
 *     organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 *     name varchar(60) NOT NULL,
 *     weight_min smallint NOT NULL DEFAULT 400,
 *     weight_max smallint NOT NULL DEFAULT 400,
 *     disk varchar(30) NOT NULL, path varchar(255) NOT NULL,
 *     size integer NOT NULL, checksum char(64) NOT NULL,
 *     created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *     updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *     created_at timestamptz NULL, updated_at timestamptz NULL,
 *     CONSTRAINT storefront_fonts_organization_id_checksum_unique UNIQUE (organization_id, checksum)
 *   );
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_fonts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            // The name shown in the font pickers (unique per organization, case-insensitive: checked by the action).
            $table->string('name', 60);
            // The weights the file covers (a variable font: a range; a static font: one weight).
            $table->unsignedSmallInteger('weight_min')->default(400);
            $table->unsignedSmallInteger('weight_max')->default(400);
            $table->string('disk', 30);
            $table->string('path');
            $table->unsignedInteger('size');
            $table->char('checksum', 64);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            // The same file uploaded twice is refused (FONT_DUPLICATE).
            $table->unique(['organization_id', 'checksum']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_fonts');
    }
};
