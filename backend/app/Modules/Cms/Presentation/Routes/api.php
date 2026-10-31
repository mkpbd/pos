<?php

use App\Modules\Cms\Presentation\Http\Controllers\ContactMessageController;
use App\Modules\Cms\Presentation\Http\Controllers\FaqController;
use App\Modules\Cms\Presentation\Http\Controllers\NewsletterSubscriberController;
use App\Modules\Cms\Presentation\Http\Controllers\PageController;
use App\Modules\Cms\Presentation\Http\Controllers\StoreContentController;
use Illuminate\Support\Facades\Route;

// Public storefront content: organization from the host name, no authentication.
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    Route::get('pages/{slug}', [StoreContentController::class, 'page'])->where('slug', '[A-Za-z0-9-]{1,100}');
    Route::get('faq', [StoreContentController::class, 'faq']);
    Route::post('contact', [StoreContentController::class, 'contact'])->middleware('throttle:contact');
    Route::post('newsletter', [StoreContentController::class, 'subscribe'])->middleware('throttle:newsletter');
    Route::post('newsletter/confirm', [StoreContentController::class, 'confirm']);
    Route::post('newsletter/unsubscribe', [StoreContentController::class, 'unsubscribe']);
});

// Content administration.
Route::middleware(['auth:sanctum', 'tenant', 'can:cms.manage'])->prefix('cms')->group(function () {
    Route::get('pages', [PageController::class, 'index']);
    Route::post('pages', [PageController::class, 'store']);
    Route::get('pages/{page}', [PageController::class, 'show'])->whereUuid('page');
    Route::patch('pages/{page}', [PageController::class, 'update'])->whereUuid('page');
    Route::delete('pages/{page}', [PageController::class, 'destroy'])->whereUuid('page');

    Route::get('faq', [FaqController::class, 'index']);
    Route::post('faq', [FaqController::class, 'store']);
    Route::put('faq/order', [FaqController::class, 'reorder']);
    Route::patch('faq/{faqItem}', [FaqController::class, 'update'])->whereUuid('faqItem');
    Route::delete('faq/{faqItem}', [FaqController::class, 'destroy'])->whereUuid('faqItem');

    Route::get('contact-messages', [ContactMessageController::class, 'index']);
    Route::patch('contact-messages/{contactMessage}', [ContactMessageController::class, 'update'])->whereUuid('contactMessage');

    Route::get('newsletter-subscribers', [NewsletterSubscriberController::class, 'index']);
    Route::get('newsletter-subscribers/export', [NewsletterSubscriberController::class, 'export']);
});
