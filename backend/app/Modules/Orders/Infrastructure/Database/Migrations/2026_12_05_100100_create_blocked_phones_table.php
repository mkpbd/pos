<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * BD1b: mobile numbers the organization does not deliver cash on delivery to (refused parcels,
 * fake orders). Shop and landing-page orders paid by cash on delivery with a blocked contact or
 * delivery phone are refused (COD_NOT_AVAILABLE); staff-entered orders only show a warning.
 * `phone` is the normalised national form (01XXXXXXXXX), one row per number.
 *
 * Manual SQL (PostgreSQL):
 *   CREATE TABLE blocked_phones (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations,
 *     phone varchar(20) NOT NULL, reason varchar(200), created_by uuid REFERENCES users ON DELETE SET NULL,
 *     created_at timestamptz NOT NULL, UNIQUE (organization_id, phone));
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('blocked_phones', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            $table->string('phone', 20);
            $table->string('reason', 200)->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('created_at');

            $table->unique(['organization_id', 'phone']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('blocked_phones');
    }
};
