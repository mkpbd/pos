<?php

use App\Modules\Reports\Presentation\Http\Controllers\DashboardController;
use App\Modules\Reports\Presentation\Http\Controllers\ReportController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('dashboard', DashboardController::class)->middleware('can:dashboard.view');

    // `reports.view` or `reports.financial` (per report, checked in the controller).
    Route::get('reports', [ReportController::class, 'index']);
    Route::get('reports/{key}', [ReportController::class, 'show'])->where('key', '[a-z0-9_]+');
});
