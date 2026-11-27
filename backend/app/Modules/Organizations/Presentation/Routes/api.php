<?php

use App\Modules\Organizations\Presentation\Http\Controllers\AlertSettingsController;
use App\Modules\Organizations\Presentation\Http\Controllers\CurrentOrganizationController;
use App\Modules\Organizations\Presentation\Http\Controllers\PlatformOrganizationController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('organization', [CurrentOrganizationController::class, 'show'])->middleware('can:organization.view');
    Route::patch('organization', [CurrentOrganizationController::class, 'update'])->middleware('can:organization.update');
    // R1: scheduled alerts and due reminders.
    Route::get('settings/alerts', [AlertSettingsController::class, 'show'])->middleware('can:organization.view');
    Route::patch('settings/alerts', [AlertSettingsController::class, 'update'])->middleware('can:organization.update');
});

Route::prefix('platform')->middleware(['auth:sanctum', 'tenant:optional', 'platform'])->group(function () {
    Route::get('organizations', [PlatformOrganizationController::class, 'index']);
    Route::post('organizations', [PlatformOrganizationController::class, 'store']);
    Route::patch('organizations/{organization}/status', [PlatformOrganizationController::class, 'updateStatus']);
});
