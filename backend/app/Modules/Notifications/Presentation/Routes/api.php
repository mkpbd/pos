<?php

use App\Modules\Notifications\Presentation\Http\Controllers\NotificationController;
use Illuminate\Support\Facades\Route;

Route::prefix('notifications')->middleware(['auth:sanctum', 'tenant:optional'])->group(function () {
    Route::get('/', [NotificationController::class, 'index']);
    Route::get('unread-count', [NotificationController::class, 'unreadCount']);
    Route::post('read-all', [NotificationController::class, 'markAllRead']);
    Route::post('{notificationId}/read', [NotificationController::class, 'markRead'])->whereUuid('notificationId');
});
