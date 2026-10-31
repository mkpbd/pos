<?php

use App\Modules\System\Presentation\Http\Controllers\HealthController;
use Illuminate\Support\Facades\Route;

Route::get('health', HealthController::class)->name('system.health');
