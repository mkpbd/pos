<?php

use App\Modules\AI\Presentation\Http\Controllers\AiAssistantController;
use App\Modules\AI\Presentation\Http\Controllers\AiInsightsController;
use App\Modules\AI\Presentation\Http\Controllers\AiSettingsController;
use App\Modules\AI\Presentation\Http\Controllers\AssistantConversationController;
use App\Modules\AI\Presentation\Http\Controllers\StoreAssistantController;
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

// AI2b: the online store's shopper assistant (store host, guests and signed-in shoppers; never cached).
Route::middleware(['storefront', 'storefront.session', 'customer.active:optional'])->prefix('store/assistant')->group(function () {
    Route::post('messages', [StoreAssistantController::class, 'send'])->middleware('throttle:store-assistant')->name('store.assistant.send');
    Route::get('conversations/current', [StoreAssistantController::class, 'current'])->middleware('throttle:storefront')->name('store.assistant.current');
});

// AI2b: the shop assistant's conversations for staff.
Route::middleware(['auth:sanctum', 'tenant', 'can:storefront.manage'])->prefix('storefront/assistant')->group(function () {
    Route::get('conversations', [AssistantConversationController::class, 'index']);
    Route::get('conversations/{conversation}', [AssistantConversationController::class, 'show'])->whereUuid('conversation');
    Route::get('summary', [AssistantConversationController::class, 'summary']);
});
