<?php

use App\Modules\System\Presentation\Http\Controllers\BackupController;
use App\Modules\System\Presentation\Http\Controllers\ErrorEventController;
use App\Modules\System\Presentation\Http\Controllers\FailedJobController;
use App\Modules\System\Presentation\Http\Controllers\HealthController;
use App\Modules\System\Presentation\Http\Controllers\MailTestController;
use App\Modules\System\Presentation\Http\Controllers\SystemStatusController;
use Illuminate\Support\Facades\Route;

Route::get('health', HealthController::class)->name('system.health');

// G1b: operations (install-wide, not tenant data) — platform admins only.
Route::prefix('platform/system')->middleware(['auth:sanctum', 'tenant:optional', 'platform'])->group(function () {
    Route::get('status', SystemStatusController::class);

    Route::get('backups', [BackupController::class, 'index']);
    Route::post('backups', [BackupController::class, 'store']);
    Route::post('backups/{backup}/verify', [BackupController::class, 'verify'])->whereUuid('backup');

    Route::get('failed-jobs', [FailedJobController::class, 'index']);
    Route::post('failed-jobs/retry-all', [FailedJobController::class, 'retryAll']);
    Route::post('failed-jobs/{uuid}/retry', [FailedJobController::class, 'retry'])->where('uuid', '[A-Za-z0-9\-]+');
    Route::delete('failed-jobs/{uuid}', [FailedJobController::class, 'destroy'])->where('uuid', '[A-Za-z0-9\-]+');

    Route::get('errors', [ErrorEventController::class, 'index']);
    Route::get('errors/{error}', [ErrorEventController::class, 'show'])->whereUuid('error');
    Route::patch('errors/{error}', [ErrorEventController::class, 'update'])->whereUuid('error');

    Route::post('mail-test', MailTestController::class)->middleware('throttle:5,1');
});
