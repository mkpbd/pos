<?php

use App\Modules\CustomerAccounts\Presentation\Http\Controllers\AccountController;
use App\Modules\CustomerAccounts\Presentation\Http\Controllers\AddressController;
use App\Modules\CustomerAccounts\Presentation\Http\Controllers\CustomerAccountAdminController;
use App\Modules\CustomerAccounts\Presentation\Http\Controllers\PhoneAccountController;
use Illuminate\Support\Facades\Route;

// Shopper accounts: organization from the host name, cookie session + CSRF, `customer` guard (ADR-002).
Route::middleware(['storefront', 'storefront.session', 'throttle:storefront'])->prefix('store/account')->group(function () {
    Route::get('me', [AccountController::class, 'me'])->middleware('customer.active:optional')->name('store.account.me');
    Route::post('logout', [AccountController::class, 'logout'])->name('store.account.logout');
    Route::post('verify-email', [AccountController::class, 'verifyEmail'])->middleware('throttle:storefront-write');

    Route::middleware('throttle:customer-auth')->group(function () {
        Route::post('register', [AccountController::class, 'register'])->name('store.account.register');
        Route::post('login', [AccountController::class, 'login'])->name('store.account.login');
        Route::post('forgot-password', [AccountController::class, 'forgotPassword']);
        Route::post('reset-password', [AccountController::class, 'resetPassword']);

        // BD1a: sign-in with a mobile number and an SMS code (`verify_phone` codes need a signed-in shopper).
        Route::post('otp/send', [PhoneAccountController::class, 'send'])->middleware('customer.active:optional');
        Route::post('otp/login', [PhoneAccountController::class, 'login'])->middleware('customer.active:optional');
        Route::post('otp/register', [PhoneAccountController::class, 'register'])->middleware('customer.active:optional');
    });

    Route::middleware(['auth:customer', 'customer.active'])->group(function () {
        Route::post('verification-notification', [AccountController::class, 'resendVerification'])->middleware('throttle:customer-auth');
        Route::put('password', [AccountController::class, 'changePassword'])->middleware('throttle:customer-auth');
        Route::post('profile/phone', [PhoneAccountController::class, 'verifyPhone'])->middleware('throttle:customer-auth');
        Route::get('profile', [AccountController::class, 'profile']);
        Route::get('addresses', [AddressController::class, 'index']);

        Route::middleware('throttle:storefront-write')->group(function () {
            Route::put('profile', [AccountController::class, 'updateProfile']);
            Route::post('addresses', [AddressController::class, 'store']);
            Route::patch('addresses/{addressId}', [AddressController::class, 'update'])->whereUuid('addressId');
            Route::delete('addresses/{addressId}', [AddressController::class, 'destroy'])->whereUuid('addressId');
        });
    });
});

// Staff: enable/disable a customer's online sign-in.
Route::middleware(['auth:sanctum', 'tenant', 'can:customers.manage'])
    ->patch('customer-accounts/{customerId}', [CustomerAccountAdminController::class, 'update'])
    ->whereUuid('customerId');
