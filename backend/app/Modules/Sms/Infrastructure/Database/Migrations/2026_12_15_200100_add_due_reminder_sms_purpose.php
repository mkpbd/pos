<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * R1: due (বাকি) reminders to customers are text messages of their own purpose
 * (`due_reminder`, related to the customer).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_purpose_check;
            ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_purpose_check
                CHECK (purpose IN ('otp', 'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'test', 'sale_receipt', 'due_reminder'));
        SQL);
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::unprepared(<<<'SQL'
            ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_purpose_check;
            ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_purpose_check
                CHECK (purpose IN ('otp', 'order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled', 'test', 'sale_receipt'));
        SQL);
    }
};
