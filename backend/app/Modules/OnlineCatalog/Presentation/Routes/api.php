<?php

use App\Modules\OnlineCatalog\Presentation\Http\Controllers\AiDraftController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\BackInStockController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\CatalogAiWriterController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\CatalogAssistantController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\ProductListingController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\SizeGuideController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\StoreCatalogController;
use App\Modules\OnlineCatalog\Presentation\Http\Controllers\TaxonomyListingController;
use Illuminate\Support\Facades\Route;

// Public shop API: organization from the host name, no authentication. ETag + public HTTP caching (E12).
Route::middleware(['storefront', 'throttle:storefront', 'storefront.cache'])->prefix('store')->group(function () {
    Route::get('categories', [StoreCatalogController::class, 'categories'])->name('store.categories');
    Route::get('categories/{slug}', [StoreCatalogController::class, 'category'])->where('slug', '[A-Za-z0-9-]{1,120}');
    Route::get('brands', [StoreCatalogController::class, 'brands'])->name('store.brands');
    Route::get('brands/{slug}', [StoreCatalogController::class, 'brand'])->where('slug', '[A-Za-z0-9-]{1,120}');
    Route::get('products', [StoreCatalogController::class, 'products'])->name('store.products');
    Route::get('products/{slug}', [StoreCatalogController::class, 'product'])->where('slug', '[A-Za-z0-9-]{1,120}');
    Route::get('products/{slug}/related', [StoreCatalogController::class, 'related'])->where('slug', '[A-Za-z0-9-]{1,120}');
    Route::get('search/suggest', [StoreCatalogController::class, 'suggest'])->name('store.suggest');
});

// P1a: "Notify me when it's back" (no caching; a signed-in shopper's account is linked).
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront', 'customer.active:optional'])->prefix('store')->group(function () {
    Route::post('products/{slug}/notify', [BackInStockController::class, 'store'])->where('slug', '[A-Za-z0-9-]{1,120}')->middleware('throttle:back-in-stock');
});

// P1a: a product's back-in-stock requests (the product editor).
Route::middleware(['auth:sanctum', 'tenant', 'can:online_catalog.view'])->group(function () {
    Route::get('products/{productId}/back-in-stock-requests', [BackInStockController::class, 'index'])->whereUuid('productId');
});

// Online catalog administration.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('online-catalog')->group(function () {
    Route::middleware('can:online_catalog.view')->group(function () {
        // P1a: size guides.
        Route::get('size-guides', [SizeGuideController::class, 'index']);
        Route::get('size-guides/{sizeGuideId}', [SizeGuideController::class, 'show'])->whereUuid('sizeGuideId');
        Route::get('products/{productId}', [ProductListingController::class, 'show'])->whereUuid('productId');
        Route::get('categories', [TaxonomyListingController::class, 'categories']);
        Route::get('categories/{categoryId}', [TaxonomyListingController::class, 'category'])->whereUuid('categoryId');
        Route::get('brands', [TaxonomyListingController::class, 'brands']);
        Route::get('brands/{brandId}', [TaxonomyListingController::class, 'brand'])->whereUuid('brandId');
    });

    Route::middleware('can:online_catalog.manage')->group(function () {
        Route::put('products/{productId}', [ProductListingController::class, 'update'])->whereUuid('productId');
        Route::put('products/{productId}/related', [ProductListingController::class, 'updateRelated'])->whereUuid('productId');
        Route::put('categories/{categoryId}', [TaxonomyListingController::class, 'updateCategory'])->whereUuid('categoryId');
        Route::put('brands/{brandId}', [TaxonomyListingController::class, 'updateBrand'])->whereUuid('brandId');
        Route::post('size-guides', [SizeGuideController::class, 'store']);
        Route::put('size-guides/{sizeGuideId}', [SizeGuideController::class, 'update'])->whereUuid('sizeGuideId');
        Route::delete('size-guides/{sizeGuideId}', [SizeGuideController::class, 'destroy'])->whereUuid('sizeGuideId');
    });
});

// AI2a: category suggestions and bundle ideas (Backend B). AI calls go through the AI module's gate and budget.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('online-catalog')->group(function () {
    Route::get('bundle-ideas', [CatalogAssistantController::class, 'bundleIdeas'])->middleware('can:online_catalog.view');
    Route::middleware('can:online_catalog.manage')->group(function () {
        Route::post('ai/category-suggestions', [CatalogAssistantController::class, 'suggestCategories'])->middleware('throttle:ai');
        // Moving products to a category edits the products: products.manage as well.
        Route::post('ai/category-suggestions/apply', [CatalogAssistantController::class, 'applyCategories'])->middleware('can:products.manage');
        Route::post('bundle-ideas/describe', [CatalogAssistantController::class, 'describeBundle'])->middleware('throttle:ai');
        Route::post('bundle-ideas/apply', [CatalogAssistantController::class, 'applyBundle']);
    });
});

// AI2a: Write with AI and AI drafts (Backend A). Nothing the model writes is saved until staff approve it.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('online-catalog/ai')->group(function () {
    Route::middleware('can:online_catalog.view')->group(function () {
        Route::get('batches', [AiDraftController::class, 'index']);
        Route::get('batches/{batchId}', [AiDraftController::class, 'show'])->whereUuid('batchId');
        Route::get('drafts', [AiDraftController::class, 'drafts']);
    });
    Route::middleware('can:online_catalog.manage')->group(function () {
        Route::post('write', CatalogAiWriterController::class)->middleware('throttle:ai');
        Route::post('batches', [AiDraftController::class, 'store'])->middleware('throttle:ai');
        Route::post('batches/{batchId}/cancel', [AiDraftController::class, 'cancel'])->whereUuid('batchId');
        Route::post('drafts/approve-many', [AiDraftController::class, 'approveMany']);
        Route::post('drafts/{draftId}/approve', [AiDraftController::class, 'approve'])->whereUuid('draftId');
        Route::post('drafts/{draftId}/reject', [AiDraftController::class, 'reject'])->whereUuid('draftId');
    });
});
