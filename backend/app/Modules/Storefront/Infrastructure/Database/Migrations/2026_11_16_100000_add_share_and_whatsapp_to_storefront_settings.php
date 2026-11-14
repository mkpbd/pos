<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2b: the share bar on product, campaign and blog pages (on by default) and the store's
 * WhatsApp number (E.164 digits without "+", for wa.me links) with the "Order on WhatsApp"
 * product button and the floating chat button.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->boolean('share_buttons')->default(true);
            $table->string('whatsapp_number', 15)->nullable();
            $table->boolean('whatsapp_order_button')->default(true);
            $table->boolean('whatsapp_chat_button')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('storefront_settings', function (Blueprint $table) {
            $table->dropColumn(['share_buttons', 'whatsapp_number', 'whatsapp_order_button', 'whatsapp_chat_button']);
        });
    }
};
