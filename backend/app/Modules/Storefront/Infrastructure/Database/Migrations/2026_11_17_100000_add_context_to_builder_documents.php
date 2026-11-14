<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B9: global sections. Additive only.
 *
 * - builder_documents.context: where a global section (kind `global`, key `global:<uuid>`) may be
 *   used — `page` (pages, content pages and shop areas), `header` or `footer`. Chosen when the
 *   global is created and never changed (not versioned). Null for every other kind.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('builder_documents', function (Blueprint $table) {
            $table->string('context', 20)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('builder_documents', function (Blueprint $table) {
            $table->dropColumn('context');
        });
    }
};
