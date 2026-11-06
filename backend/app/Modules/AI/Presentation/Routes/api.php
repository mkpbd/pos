<?php

use App\Modules\AI\Presentation\Http\Controllers\AiAssistantController;
use App\Modules\AI\Presentation\Http\Controllers\AiInsightsController;
use App\Modules\AI\Presentation\Http\Controllers\AiSettingsController;
use Illuminate\Support\Facades\Route;

// Phase 8: optional AI module. Read-only: no route here changes business data.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('ai')->group(function () {
    Route::post('ask', [AiAssistantController::class, 'ask'])->middleware(['can:ai.ask', 'throttle:ai']);
    Route::post('explain-reorder', [AiAssistantController::class, 'explainReorder'])->middleware(['can:ai.ask', 'can:purchases.view', 'throttle:ai']);

    Route::get('insights', [AiInsightsController::class, 'business'])->middleware('can:ai.insights');
    Route::get('customer-insights', [AiInsightsController::class, 'customers'])->middleware('can:ai.insights');

    Route::get('settings', [AiSettingsController::class, 'show'])->middleware('can:ai.manage');
    Route::patch('settings', [AiSettingsController::class, 'update'])->middleware('can:ai.manage');
    Route::get('usage', [AiSettingsController::class, 'usage'])->middleware('can:ai.manage');
});
