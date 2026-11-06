<?php

use App\Modules\Shared\Infrastructure\Persistence\IdempotencyKey;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Stored idempotent responses are only needed while clients may still retry.
Schedule::command('model:prune', ['--model' => [IdempotencyKey::class]])->daily();

// Storefront popularity ("best sellers", popularity sort) from completed sales.
Schedule::command('storefront:refresh-product-stats')->hourly()->withoutOverlapping();

// Guest carts expire 30 days after their last change.
Schedule::command('cart:prune')->daily();

// SC1: daily "items need reordering" inbox alert per store, from 07:00 in each organization's
// timezone (hourly runs; one notification per store and local day).
Schedule::command('purchasing:reorder-notifications')->hourly()->withoutOverlapping();

// SC2: daily "quotes overdue" reminder per RFQ past its reply-by date, from 07:00 local time
// (hourly runs; one notification per RFQ and local day).
Schedule::command('purchasing:rfq-reminders')->hourly()->withoutOverlapping();

// Unpaid bank-transfer web orders are cancelled (and restocked) when their payment hold runs out.
Schedule::command('orders:expire-pending')->everyMinute()->withoutOverlapping();
