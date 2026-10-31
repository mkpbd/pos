<?php

use App\Modules\Media\Presentation\Http\Controllers\MediaController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant', 'can:media.manage'])->group(function () {
    Route::get('media', [MediaController::class, 'index']);
    Route::post('media', [MediaController::class, 'store']);
    Route::patch('media/{media}', [MediaController::class, 'update'])->whereUuid('media');
    Route::delete('media/{media}', [MediaController::class, 'destroy'])->whereUuid('media');
});
