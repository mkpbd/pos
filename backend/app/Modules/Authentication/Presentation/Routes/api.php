<?php

use App\Modules\Authentication\Presentation\Http\Controllers\AuthOptionsController;
use App\Modules\Authentication\Presentation\Http\Controllers\LoginActivityController;
use App\Modules\Authentication\Presentation\Http\Controllers\PasswordController;
use App\Modules\Authentication\Presentation\Http\Controllers\PinController;
use App\Modules\Authentication\Presentation\Http\Controllers\RegistrationController;
use App\Modules\Authentication\Presentation\Http\Controllers\SessionController;
use App\Modules\Authentication\Presentation\Http\Controllers\TokenController;
use App\Modules\Authentication\Presentation\Http\Controllers\TwoFactorController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    // Q1: public — the login page offers "Create an account" only when sign-up is open.
    Route::get('options', AuthOptionsController::class)->name('auth.options');

    Route::middleware('throttle:auth')->group(function () {
        Route::post('login', [SessionController::class, 'login'])->name('auth.login');
        // G1a: second step of a web sign-in with two-factor (pending challenge in the session).
        Route::post('two-factor-challenge', [SessionController::class, 'challenge'])->name('auth.two-factor-challenge');
        Route::post('register', RegistrationController::class)->name('auth.register');
        Route::post('tokens', [TokenController::class, 'store'])->name('auth.tokens.store');
        Route::post('forgot-password', [PasswordController::class, 'forgot'])->name('auth.password.forgot');
        Route::post('reset-password', [PasswordController::class, 'reset'])->name('auth.password.reset');
    });

    // POS1a: sign-in with a till PIN (guest or signed in — switch cashier) on a device set up as a till.
    Route::post('pin', [PinController::class, 'signIn'])->middleware('throttle:till-pin')->name('auth.pin');
    // POS1a: the POS screen unlock with the signed-in user's own PIN.
    Route::post('pin/verify', [PinController::class, 'verify'])
        ->middleware(['auth:sanctum', 'tenant:optional', 'throttle:till-pin'])->name('auth.pin.verify');

    Route::middleware(['auth:sanctum', 'tenant:optional'])->group(function () {
        Route::get('me', [SessionController::class, 'me'])->name('auth.me');
        Route::post('logout', [SessionController::class, 'logout'])->name('auth.logout');
        Route::put('password', [PasswordController::class, 'change'])->middleware('throttle:auth')->name('auth.password.change');
        Route::get('tokens', [TokenController::class, 'index'])->name('auth.tokens.index');
        Route::delete('tokens/{tokenId}', [TokenController::class, 'destroy'])->whereNumber('tokenId')->name('auth.tokens.destroy');
        Route::get('login-activity', [LoginActivityController::class, 'mine'])->name('auth.login-activity');

        // G1a: own two-factor sign-in. `auth.two-factor.*` stays reachable while setup is required.
        Route::get('two-factor', [TwoFactorController::class, 'show'])->name('auth.two-factor.show');
        Route::middleware('throttle:auth')->group(function () {
            Route::post('two-factor/setup', [TwoFactorController::class, 'setup'])->name('auth.two-factor.setup');
            Route::post('two-factor/confirm', [TwoFactorController::class, 'confirm'])->name('auth.two-factor.confirm');
            Route::post('two-factor/recovery-codes', [TwoFactorController::class, 'regenerateRecoveryCodes'])->name('auth.two-factor.recovery-codes');
            Route::delete('two-factor', [TwoFactorController::class, 'destroy'])->name('auth.two-factor.destroy');
        });
    });
});

// POS1a: own till PIN (needs the current password).
Route::middleware(['auth:sanctum', 'tenant:optional', 'throttle:auth'])->prefix('profile')->group(function () {
    Route::put('pin', [PinController::class, 'update'])->name('profile.pin.update');
    Route::delete('pin', [PinController::class, 'destroy'])->name('profile.pin.destroy');
});

Route::middleware(['auth:sanctum', 'tenant', 'can:audit.view'])
    ->get('login-activities', [LoginActivityController::class, 'index'])
    ->name('login-activities.index');
