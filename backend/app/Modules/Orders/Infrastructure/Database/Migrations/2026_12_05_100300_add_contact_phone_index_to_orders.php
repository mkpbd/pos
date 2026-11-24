<?php

use App\Modules\Shared\Infrastructure\Persistence\ConcurrentIndex;
use Illuminate\Database\Migrations\Migration;

/**
 * BD1b: the delivery history of a mobile number (orders by `contact_phone`, for the order
 * detail, the risk column of the orders list and the cash-on-delivery review at checkout) is
 * an equality lookup; the G1c trigram index serves `ILIKE` search, not this. A btree on
 * (organization_id, contact_phone), built CONCURRENTLY on PostgreSQL.
 */
return new class extends Migration
{
    public $withinTransaction = false;

    public function up(): void
    {
        ConcurrentIndex::create(
            'orders_organization_id_contact_phone_index',
            'orders (organization_id, contact_phone)',
            'orders (organization_id, contact_phone)',
        );
    }

    public function down(): void
    {
        ConcurrentIndex::drop('orders_organization_id_contact_phone_index');
    }
};
