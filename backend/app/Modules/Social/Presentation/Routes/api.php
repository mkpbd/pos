<?php

use App\Modules\Social\Presentation\Http\Controllers\CaptionSuggestionController;
use App\Modules\Social\Presentation\Http\Controllers\ProductFeedController;
use App\Modules\Social\Presentation\Http\Controllers\SocialAccountController;
use App\Modules\Social\Presentation\Http\Controllers\SocialPostController;
use App\Modules\Social\Presentation\Http\Controllers\SocialSettingsController;
use Illuminate\Support\Facades\Route;

// P2b: Marketing → Social (Facebook & Instagram) and Product feeds. Connecting Facebook
// (/social/meta/connect and /callback) are browser navigations: see web.php.
Route::prefix('social')->middleware(['auth:sanctum', 'tenant'])->group(function () {
    Route::middleware('can:social.view')->group(function () {
        Route::get('settings', [SocialSettingsController::class, 'show']);
        Route::get('accounts', [SocialAccountController::class, 'show']);
        Route::get('posts', [SocialPostController::class, 'index']);
        Route::get('posts/{post}', [SocialPostController::class, 'show'])->whereUuid('post');
        Route::get('feeds', [ProductFeedController::class, 'index']);
    });

    Route::middleware('can:social.manage')->group(function () {
        Route::patch('settings', [SocialSettingsController::class, 'update']);
        Route::post('accounts/select', [SocialAccountController::class, 'select']);
        Route::delete('accounts', [SocialAccountController::class, 'destroy']);

        Route::post('posts', [SocialPostController::class, 'store']);
        Route::patch('posts/{post}', [SocialPostController::class, 'update'])->whereUuid('post');
        Route::post('posts/{post}/publish', [SocialPostController::class, 'publish'])->whereUuid('post');
        Route::post('posts/{post}/cancel', [SocialPostController::class, 'cancel'])->whereUuid('post');
        Route::post('posts/{post}/retry', [SocialPostController::class, 'retry'])->whereUuid('post');
        Route::delete('posts/{post}', [SocialPostController::class, 'destroy'])->whereUuid('post');

        Route::post('caption-suggestions', CaptionSuggestionController::class)->middleware('throttle:social-captions');

        Route::patch('feeds/{channel}', [ProductFeedController::class, 'update'])->whereIn('channel', ['meta', 'tiktok', 'pinterest']);
        Route::post('feeds/{channel}/rotate', [ProductFeedController::class, 'rotate'])->whereIn('channel', ['meta', 'tiktok', 'pinterest']);
    });
});
