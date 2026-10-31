<?php

use App\Modules\Catalog\Presentation\Http\Controllers\AttributeController;
use App\Modules\Catalog\Presentation\Http\Controllers\BrandController;
use App\Modules\Catalog\Presentation\Http\Controllers\CategoryController;
use App\Modules\Catalog\Presentation\Http\Controllers\TaxRateController;
use App\Modules\Catalog\Presentation\Http\Controllers\UnitController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    // Reference lists are readable by anyone who may see products (needed for forms and filters).
    $resources = [
        'categories' => [CategoryController::class, 'category', 'categories.manage'],
        'brands' => [BrandController::class, 'brand', 'brands.manage'],
        'units' => [UnitController::class, 'unit', 'units.manage'],
        'tax-rates' => [TaxRateController::class, 'taxRate', 'taxes.manage'],
    ];

    foreach ($resources as $path => [$controller, $parameter, $managePermission]) {
        Route::get($path, [$controller, 'index'])->middleware('can:products.view');
        Route::post($path, [$controller, 'store'])->middleware("can:{$managePermission}");
        Route::patch("{$path}/{{$parameter}}", [$controller, 'update'])->middleware("can:{$managePermission}");
        Route::delete("{$path}/{{$parameter}}", [$controller, 'destroy'])->middleware("can:{$managePermission}");
    }

    // Attribute dictionary: readable by product viewers and attribute managers.
    Route::get('attributes', [AttributeController::class, 'index'])->middleware('can:attributes.read');
    Route::post('attributes', [AttributeController::class, 'store'])->middleware('can:attributes.manage');
    Route::patch('attributes/{attribute}', [AttributeController::class, 'update'])->whereUuid('attribute')->middleware('can:attributes.manage');
    Route::delete('attributes/{attribute}', [AttributeController::class, 'destroy'])->whereUuid('attribute')->middleware('can:attributes.manage');
});
