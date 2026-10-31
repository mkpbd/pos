<?php

use App\Modules\Audit\Presentation\Http\Controllers\AuditLogController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant', 'can:audit.view'])
    ->get('audit-logs', [AuditLogController::class, 'index'])
    ->name('audit-logs.index');
