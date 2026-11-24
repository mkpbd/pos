<?php

use App\Modules\Sms\Presentation\Http\Controllers\SmsMessageController;
use App\Modules\Sms\Presentation\Http\Controllers\SmsSettingsController;
use Illuminate\Support\Facades\Route;

// BD1a: Settings → SMS (gateway, order message templates, test message, message log).
Route::prefix('sms')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::middleware('can:sms.view')->group(function () {
        Route::get('settings', [SmsSettingsController::class, 'show']);
        Route::get('messages', [SmsMessageController::class, 'index']);
    });

    Route::middleware('can:sms.manage')->group(function () {
        Route::patch('settings', [SmsSettingsController::class, 'update']);
        Route::post('test', [SmsMessageController::class, 'test'])->middleware('throttle:sms-test');
    });
});
