<?php

use App\Modules\Authentication\Presentation\Http\Controllers\LoginActivityController;
use App\Modules\Authentication\Presentation\Http\Controllers\PasswordController;
use App\Modules\Authentication\Presentation\Http\Controllers\RegistrationController;
use App\Modules\Authentication\Presentation\Http\Controllers\SessionController;
use App\Modules\Authentication\Presentation\Http\Controllers\TokenController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::middleware('throttle:auth')->group(function () {
        Route::post('login', [SessionController::class, 'login'])->name('auth.login');
        Route::post('register', RegistrationController::class)->name('auth.register');
        Route::post('tokens', [TokenController::class, 'store'])->name('auth.tokens.store');
        Route::post('forgot-password', [PasswordController::class, 'forgot'])->name('auth.password.forgot');
        Route::post('reset-password', [PasswordController::class, 'reset'])->name('auth.password.reset');
    });

    Route::middleware(['auth:sanctum', 'tenant:optional'])->group(function () {
        Route::get('me', [SessionController::class, 'me'])->name('auth.me');
        Route::post('logout', [SessionController::class, 'logout'])->name('auth.logout');
        Route::put('password', [PasswordController::class, 'change'])->middleware('throttle:auth')->name('auth.password.change');
        Route::get('tokens', [TokenController::class, 'index'])->name('auth.tokens.index');
        Route::delete('tokens/{tokenId}', [TokenController::class, 'destroy'])->whereNumber('tokenId')->name('auth.tokens.destroy');
        Route::get('login-activity', [LoginActivityController::class, 'mine'])->name('auth.login-activity');
    });
});

Route::middleware(['auth:sanctum', 'tenant', 'can:audit.view'])
    ->get('login-activities', [LoginActivityController::class, 'index'])
    ->name('login-activities.index');
