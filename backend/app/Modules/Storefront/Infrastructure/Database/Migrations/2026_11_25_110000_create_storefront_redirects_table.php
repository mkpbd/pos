<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B16: storefront redirects — an old address of the store (`from_path`, normalized: lower case,
 * no query, no trailing slash; unique per organization) answered with a 301 / 302 to `to_path`
 * (a store path, or for manual redirects any http(s) URL). `source` auto (a page, post, product,
 * category or brand got a new address) or manual. `hits` / `last_hit_at` are counted at most once
 * a minute per redirect (no visitor data). Additive only.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE storefront_redirects (
 *     id uuid PRIMARY KEY,
 *     organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 *     from_path varchar(500) NOT NULL,
 *     to_path varchar(1000) NOT NULL,
 *     type smallint NOT NULL DEFAULT 301,
 *     source varchar(10) NOT NULL DEFAULT 'manual',
 *     hits bigint NOT NULL DEFAULT 0,
 *     last_hit_at timestamptz NULL,
 *     created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
 *     created_at timestamptz NULL, updated_at timestamptz NULL,
 *     CONSTRAINT storefront_redirects_org_from_unique UNIQUE (organization_id, from_path)
 *   );
 *   CREATE INDEX storefront_redirects_org_to_idx ON storefront_redirects (organization_id, to_path);
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_redirects', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('from_path', 500);
            $table->string('to_path', 1000);
            $table->smallInteger('type')->default(301);
            $table->string('source', 10)->default('manual');
            $table->unsignedBigInteger('hits')->default(0);
            $table->timestampTz('last_hit_at')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->unique(['organization_id', 'from_path'], 'storefront_redirects_org_from_unique');
            $table->index(['organization_id', 'to_path'], 'storefront_redirects_org_to_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_redirects');
    }
};
