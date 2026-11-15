<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('media', function (Blueprint $table) {
            // B11: the point of the picture that must stay visible when the storefront crops it
            // with CSS (object-position), in percent of the width / height; both null = centre.
            $table->smallInteger('focal_x')->nullable();
            $table->smallInteger('focal_y')->nullable();
            // B11: an edited copy remembers the picture it was made from (null once that is deleted).
            $table->foreignUuid('edited_from_id')->nullable()->constrained('media')->nullOnDelete();
        });

        DB::statement('ALTER TABLE media ADD CONSTRAINT media_focal_range CHECK ('
            .'(focal_x IS NULL AND focal_y IS NULL) OR (focal_x BETWEEN 0 AND 100 AND focal_y BETWEEN 0 AND 100))');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE media DROP CONSTRAINT IF EXISTS media_focal_range');
        Schema::table('media', function (Blueprint $table) {
            $table->dropConstrainedForeignId('edited_from_id');
            $table->dropColumn(['focal_x', 'focal_y']);
        });
    }
};
