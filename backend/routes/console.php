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
