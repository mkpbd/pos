<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SC2: purchase order lines remember the requisition line they were converted from (directly
 * or through an RFQ award), so cancelling the order gives the unreceived quantity back to the
 * requisition. NULL for orders not created from a requisition (and for older orders).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('purchase_order_lines', function (Blueprint $table) {
            $table->foreignUuid('requisition_line_id')->nullable()->after('variant_id')->constrained('purchase_requisition_lines')->restrictOnDelete();
            $table->index('requisition_line_id');
        });
    }

    public function down(): void
    {
        Schema::table('purchase_order_lines', function (Blueprint $table) {
            $table->dropIndex(['requisition_line_id']);
            $table->dropConstrainedForeignId('requisition_line_id');
        });
    }
};
