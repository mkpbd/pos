<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The organization's media library: images used by the storefront (logos, banners, menus, pages).
        Schema::create('media', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('disk', 30);
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 50);
            $table->unsignedInteger('size');
            $table->unsignedSmallInteger('width');
            $table->unsignedSmallInteger('height');
            $table->string('alt', 200)->nullable();
            // Generated WebP copies keyed by width, e.g. {"320": "media/<org>/<id>-320.webp"}.
            $table->jsonb('renditions')->default('{}');
            $table->char('checksum', 64);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampsTz();

            $table->index(['organization_id', 'created_at']);
            // The same file uploaded twice is stored once.
            $table->unique(['organization_id', 'checksum']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('media');
    }
};
