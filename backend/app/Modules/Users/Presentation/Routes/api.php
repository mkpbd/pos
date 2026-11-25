<?php

use App\Modules\Users\Presentation\Http\Controllers\PermissionController;
use App\Modules\Users\Presentation\Http\Controllers\RoleController;
use App\Modules\Users\Presentation\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::get('users', [UserController::class, 'index'])->middleware('can:users.view');
    Route::post('users', [UserController::class, 'store'])->middleware('can:users.manage');
    Route::get('users/{user}', [UserController::class, 'show'])->middleware('can:users.view');
    Route::patch('users/{user}', [UserController::class, 'update'])->middleware('can:users.manage');
    // G1a: help with another user's sign-in.
    Route::post('users/{user}/unlock', [UserController::class, 'unlock'])->middleware('can:users.manage');
    Route::post('users/{user}/two-factor/reset', [UserController::class, 'resetTwoFactor'])->middleware('can:users.manage');
    // POS1a: clear a forgotten or shared till PIN.
    Route::delete('users/{user}/pin', [UserController::class, 'clearPin'])->middleware('can:users.manage');

    Route::get('roles', [RoleController::class, 'index'])->middleware('can:roles.view');
    Route::post('roles', [RoleController::class, 'store'])->middleware('can:roles.manage');
    Route::get('roles/{role}', [RoleController::class, 'show'])->middleware('can:roles.view');
    Route::put('roles/{role}', [RoleController::class, 'update'])->middleware('can:roles.manage');
    Route::delete('roles/{role}', [RoleController::class, 'destroy'])->middleware('can:roles.manage');

    Route::get('permissions', [PermissionController::class, 'index'])->middleware('can:roles.view');
});
