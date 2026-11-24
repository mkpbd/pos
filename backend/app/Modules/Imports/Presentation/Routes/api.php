<?php

use App\Modules\Imports\Presentation\Http\Controllers\ImportController;
use Illuminate\Support\Facades\Route;

// ST1: bulk import. Each type needs its owner's permission (checked per type in the controller).
Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('imports/types', [ImportController::class, 'types']);
    Route::get('imports/templates/{type}', [ImportController::class, 'template'])->where('type', '[a-z_]+');
    Route::get('imports', [ImportController::class, 'index']);
    Route::post('imports', [ImportController::class, 'store']);
    Route::get('imports/{import}', [ImportController::class, 'show'])->whereUuid('import');
    Route::get('imports/{import}/errors.csv', [ImportController::class, 'errors'])->whereUuid('import');
    Route::post('imports/{import}/run', [ImportController::class, 'run'])->whereUuid('import');
    Route::post('imports/{import}/cancel', [ImportController::class, 'cancel'])->whereUuid('import');
});
