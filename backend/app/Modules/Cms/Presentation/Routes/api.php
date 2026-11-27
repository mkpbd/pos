<?php

use App\Modules\Cms\Application\Actions\NewsletterSubscriptions;
use App\Modules\Cms\Presentation\Http\Controllers\BlogCategoryController;
use App\Modules\Cms\Presentation\Http\Controllers\BlogPostController;
use App\Modules\Cms\Presentation\Http\Controllers\ContactMessageController;
use App\Modules\Cms\Presentation\Http\Controllers\FaqController;
use App\Modules\Cms\Presentation\Http\Controllers\NewsletterCampaignController;
use App\Modules\Cms\Presentation\Http\Controllers\NewsletterSubscriberController;
use App\Modules\Cms\Presentation\Http\Controllers\PageController;
use App\Modules\Cms\Presentation\Http\Controllers\StoreBlogController;
use App\Modules\Cms\Presentation\Http\Controllers\StoreContentController;
use Illuminate\Support\Facades\Route;

// Public storefront content: organization from the host name, no authentication.
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    // Reads: ETag + public HTTP caching (E12).
    Route::middleware('storefront.cache')->group(function () {
        Route::get('pages/{slug}', [StoreContentController::class, 'page'])->where('slug', '[A-Za-z0-9-]{1,100}');
        Route::get('faq', [StoreContentController::class, 'faq']);
        // E11: the blog.
        Route::get('blog', [StoreBlogController::class, 'index']);
        Route::get('blog/categories', [StoreBlogController::class, 'categories']);
        Route::get('blog/{slug}', [StoreBlogController::class, 'show'])->where('slug', '[A-Za-z0-9-]{1,100}');
    });
    Route::post('contact', [StoreContentController::class, 'contact'])->middleware('throttle:contact');
    Route::post('newsletter', [StoreContentController::class, 'subscribe'])->middleware('throttle:newsletter');
    Route::post('newsletter/confirm', [StoreContentController::class, 'confirm']);
    Route::post('newsletter/unsubscribe', [StoreContentController::class, 'unsubscribe']);
    // BD2b: the signed link in campaign e-mails.
    Route::post('newsletter/unsubscribe/{subscriber}', [StoreContentController::class, 'unsubscribeSigned'])
        ->whereUuid('subscriber')->name(NewsletterSubscriptions::SIGNED_ROUTE);
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

    // E11: the blog.
    Route::get('blog-categories', [BlogCategoryController::class, 'index']);
    Route::post('blog-categories', [BlogCategoryController::class, 'store']);
    Route::put('blog-categories/order', [BlogCategoryController::class, 'reorder']);
    Route::patch('blog-categories/{blogCategory}', [BlogCategoryController::class, 'update'])->whereUuid('blogCategory');
    Route::delete('blog-categories/{blogCategory}', [BlogCategoryController::class, 'destroy'])->whereUuid('blogCategory');
    Route::get('blog-posts', [BlogPostController::class, 'index']);
    Route::post('blog-posts', [BlogPostController::class, 'store']);
    Route::get('blog-posts/{blogPost}', [BlogPostController::class, 'show'])->whereUuid('blogPost');
    Route::patch('blog-posts/{blogPost}', [BlogPostController::class, 'update'])->whereUuid('blogPost');
    Route::delete('blog-posts/{blogPost}', [BlogPostController::class, 'destroy'])->whereUuid('blogPost');

    Route::get('contact-messages', [ContactMessageController::class, 'index']);
    Route::patch('contact-messages/{contactMessage}', [ContactMessageController::class, 'update'])->whereUuid('contactMessage');

    Route::get('newsletter-subscribers', [NewsletterSubscriberController::class, 'index']);
    Route::get('newsletter-subscribers/export', [NewsletterSubscriberController::class, 'export']);
});

// BD2b: newsletter campaigns (sent to the confirmed subscribers) and subscriber counts.
Route::middleware(['auth:sanctum', 'tenant', 'can:cms.manage'])->prefix('newsletter')->group(function () {
    Route::get('subscribers/summary', [NewsletterCampaignController::class, 'subscriberSummary']);
    Route::get('campaigns', [NewsletterCampaignController::class, 'index']);
    Route::post('campaigns', [NewsletterCampaignController::class, 'store']);
    Route::get('campaigns/{newsletterCampaign}', [NewsletterCampaignController::class, 'show'])->whereUuid('newsletterCampaign');
    Route::patch('campaigns/{newsletterCampaign}', [NewsletterCampaignController::class, 'update'])->whereUuid('newsletterCampaign');
    Route::delete('campaigns/{newsletterCampaign}', [NewsletterCampaignController::class, 'destroy'])->whereUuid('newsletterCampaign');
    Route::middleware('throttle:newsletter-send')->group(function () {
        Route::post('campaigns/{newsletterCampaign}/test', [NewsletterCampaignController::class, 'test'])->whereUuid('newsletterCampaign');
        Route::post('campaigns/{newsletterCampaign}/send', [NewsletterCampaignController::class, 'send'])->whereUuid('newsletterCampaign');
    });
});
