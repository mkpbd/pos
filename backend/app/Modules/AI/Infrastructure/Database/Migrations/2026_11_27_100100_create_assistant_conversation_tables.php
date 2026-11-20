<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AI2b: conversations of the online store's shopper assistant and their messages. A
 * conversation belongs to a browser token (only its sha256 is stored) and, once the shopper is
 * signed in, to the customer. No IP address, user agent or cookie is stored. Pruned after 30
 * days (`storefront:prune-assistant`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assistant_conversations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            // sha256 (hex) of the random token the browser holds.
            $table->char('token_hash', 64)->unique();
            $table->foreignUuid('customer_id')->nullable()->constrained()->nullOnDelete();
            $table->string('language', 2)->default('en');
            // Messages of both sides.
            $table->unsignedSmallInteger('message_count')->default(0);
            // open | closed (the shopper message limit was reached)
            $table->string('status', 10)->default('open');
            // A reply offered the hand-off (WhatsApp / contact page).
            $table->boolean('handed_off')->default(false);
            $table->timestampTz('started_at');
            $table->timestampTz('last_message_at');

            $table->index(['organization_id', 'started_at']);
            $table->index('last_message_at');
        });

        Schema::create('assistant_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('conversation_id')->constrained('assistant_conversations')->cascadeOnDelete();
            $table->foreignUuid('organization_id')->constrained()->restrictOnDelete();
            // 1, 2, 3, … within the conversation (the order of the turns).
            $table->unsignedSmallInteger('position');
            // user | assistant
            $table->string('role', 10);
            $table->text('text');
            // Names of the tools the reply used (no parameters, no results).
            $table->jsonb('tools')->nullable();
            // The server-built reply parts: products (cards), links, handoff, and the product slugs
            // the tools returned (to recognise them in later turns).
            $table->jsonb('reply')->nullable();
            // ok | unavailable | limit | budget
            $table->string('status', 12)->default('ok');
            $table->unsignedInteger('input_tokens')->default(0);
            $table->unsignedInteger('output_tokens')->default(0);
            $table->timestampTz('created_at');

            $table->unique(['conversation_id', 'position']);
            $table->index(['organization_id', 'created_at']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE assistant_conversations ADD CONSTRAINT assistant_conversations_check CHECK (language IN ('en', 'bn') AND status IN ('open', 'closed'))");
            DB::statement("ALTER TABLE assistant_messages ADD CONSTRAINT assistant_messages_check CHECK (role IN ('user', 'assistant') AND status IN ('ok', 'unavailable', 'limit', 'budget'))");
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('assistant_messages');
        Schema::dropIfExists('assistant_conversations');
    }
};
