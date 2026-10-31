<?php

use App\Modules\Products\Presentation\Http\Controllers\ProductController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('products/lookup', [ProductController::class, 'lookup'])->middleware('can:products.view');
    Route::get('products', [ProductController::class, 'index'])->middleware('can:products.view');
    Route::post('products', [ProductController::class, 'store'])->middleware('can:products.manage');
    Route::get('products/{product}', [ProductController::class, 'show'])->middleware('can:products.view');
    Route::put('products/{product}', [ProductController::class, 'update'])->middleware('can:products.manage');
    Route::delete('products/{product}', [ProductController::class, 'destroy'])->middleware('can:products.manage');
    Route::post('products/{productId}/restore', [ProductController::class, 'restore'])->whereUuid('productId')->middleware('can:products.manage');
    Route::post('products/{product}/images', [ProductController::class, 'addImage'])->middleware('can:products.manage');
    Route::delete('products/{product}/images/{imageId}', [ProductController::class, 'removeImage'])->whereUuid('imageId')->middleware('can:products.manage');
});
