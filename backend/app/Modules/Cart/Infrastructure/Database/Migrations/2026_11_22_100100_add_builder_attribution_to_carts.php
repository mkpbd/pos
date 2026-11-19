<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * B15: the store builder page and section a shopper last added to the cart from
 * (`{document_id, node_id?, device?}`, Shared\Domain\CampaignAttribution::builder); the checkout
 * keeps it in the order's attribution when the checkout itself sends none. Additive only.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('carts', function (Blueprint $table) {
            $table->jsonb('builder_attribution')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('carts', function (Blueprint $table) {
            $table->dropColumn('builder_attribution');
        });
    }
};
