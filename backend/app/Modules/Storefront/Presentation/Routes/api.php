<?php

use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Presentation\Http\Controllers\BannerController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderDocumentController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderTemplateController;
use App\Modules\Storefront\Presentation\Http\Controllers\DemoGalleryController;
use App\Modules\Storefront\Presentation\Http\Controllers\HomepageSectionController;
use App\Modules\Storefront\Presentation\Http\Controllers\LinkTargetController;
use App\Modules\Storefront\Presentation\Http\Controllers\MenuController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreBootstrapController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreBuilderPageController;
use App\Modules\Storefront\Presentation\Http\Controllers\StorefrontAdminController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreHomepageController;
use App\Modules\Storefront\Presentation\Http\Controllers\ThemeDraftController;
use Illuminate\Support\Facades\Route;

// Public storefront API: organization from the host name, no authentication.
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    // The session cookies (and XSRF-TOKEN) start here so the SPA's first unsafe request passes CSRF.
    Route::get('bootstrap', StoreBootstrapController::class)->middleware(['storefront.session', 'storefront.cache'])->name('store.bootstrap');
    Route::get('homepage', StoreHomepageController::class)->middleware('storefront.cache')->name('store.homepage');
    // B1: published store builder pages — `home` or a landing page slug (`?preview=draft` for staff).
    Route::get('builder/pages/{slug}', StoreBuilderPageController::class)->middleware('storefront.cache')
        ->where('slug', '[a-z0-9-]{2,60}')->name('store.builder-page');
});

// T2: the demo store gallery — any host, no store resolution (404 while the gallery is off).
Route::middleware('throttle:storefront')->get('demo-stores', [DemoGalleryController::class, 'index'])->name('storefront.demo-stores');

// Storefront administration.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('storefront')->group(function () {
    Route::middleware('can:storefront.view')->group(function () {
        Route::get('settings', [StorefrontAdminController::class, 'showSettings']);
        Route::get('domains', [StorefrontAdminController::class, 'domains']);
        Route::get('theme', [StorefrontAdminController::class, 'showTheme']);
        Route::get('theme/presets', [StorefrontAdminController::class, 'themePresets']);
        // B3: the theme draft (draft → publish like builder pages).
        Route::get('theme/draft', [ThemeDraftController::class, 'show']);
        Route::get('theme/versions', [ThemeDraftController::class, 'versions']);
        Route::get('menus', [MenuController::class, 'index']);
        Route::get('menus/{menu}', [MenuController::class, 'show'])->whereUuid('menu');
        Route::get('link-targets', LinkTargetController::class);
        Route::get('banners', [BannerController::class, 'index']);
        Route::get('banners/{banner}', [BannerController::class, 'show'])->whereUuid('banner');
        Route::get('homepage-sections', [HomepageSectionController::class, 'index']);
        Route::get('homepage-sections/types', [HomepageSectionController::class, 'types']);
        Route::get('homepage-sections/{section}', [HomepageSectionController::class, 'show'])->whereUuid('section');
    });

    Route::middleware('can:storefront.manage')->group(function () {
        Route::patch('settings', [StorefrontAdminController::class, 'updateSettings']);
        Route::post('domains', [StorefrontAdminController::class, 'storeDomain']);
        Route::patch('domains/{domain}', [StorefrontAdminController::class, 'updateDomain'])->whereUuid('domain');
        Route::delete('domains/{domain}', [StorefrontAdminController::class, 'destroyDomain'])->whereUuid('domain');
        // Legacy: saves the draft and publishes it in one step (B3).
        Route::put('theme', [StorefrontAdminController::class, 'updateTheme'])->middleware('can:storefront.publish');
        Route::put('theme/draft', [ThemeDraftController::class, 'save']);
        Route::post('theme/publish', [ThemeDraftController::class, 'publish'])->middleware('can:storefront.publish');
        Route::post('theme/discard', [ThemeDraftController::class, 'discard']);
        Route::post('theme/versions/{version}/restore', [ThemeDraftController::class, 'restore'])->whereUuid('version');
        // B3: applies to the draft.
        Route::post('theme/presets/{preset}/apply', [ThemeDraftController::class, 'applyPreset'])->whereIn('preset', ThemePresets::KEYS);
        Route::post('menus', [MenuController::class, 'store']);
        Route::patch('menus/{menu}', [MenuController::class, 'update'])->whereUuid('menu');
        Route::put('menus/{menu}/items', [MenuController::class, 'replaceItems'])->whereUuid('menu');
        Route::delete('menus/{menu}', [MenuController::class, 'destroy'])->whereUuid('menu');
        Route::post('banners', [BannerController::class, 'store']);
        Route::put('banners/order', [BannerController::class, 'reorder']);
        Route::patch('banners/{banner}', [BannerController::class, 'update'])->whereUuid('banner');
        Route::delete('banners/{banner}', [BannerController::class, 'destroy'])->whereUuid('banner');
        Route::post('homepage-sections', [HomepageSectionController::class, 'store']);
        Route::put('homepage-sections/order', [HomepageSectionController::class, 'reorder']);
        Route::patch('homepage-sections/{section}', [HomepageSectionController::class, 'update'])->whereUuid('section');
        Route::post('homepage-sections/{section}/duplicate', [HomepageSectionController::class, 'duplicate'])->whereUuid('section');
        Route::delete('homepage-sections/{section}', [HomepageSectionController::class, 'destroy'])->whereUuid('section');
    });

    Route::put('theme/custom-css', [StorefrontAdminController::class, 'updateCustomCss'])->middleware('can:storefront.custom_css');
});

// B1: the visual store builder — documents with draft / publish / versions.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('storefront/builder')->group(function () {
    Route::middleware('can:storefront.view')->group(function () {
        Route::get('elements', [BuilderDocumentController::class, 'elements']);
        Route::get('documents', [BuilderDocumentController::class, 'index']);
        Route::get('documents/{document}', [BuilderDocumentController::class, 'show'])->whereUuid('document');
        Route::get('documents/{document}/versions', [BuilderDocumentController::class, 'versions'])->whereUuid('document');
        Route::get('documents/{document}/render', [BuilderDocumentController::class, 'render'])->whereUuid('document');
        // B2: the editor canvas — the store bootstrap of the staff member's own organization.
        Route::get('canvas-context', [BuilderDocumentController::class, 'canvasContext']);
        // B5: built-in and own templates (no content).
        Route::get('templates', [BuilderTemplateController::class, 'index']);
    });

    Route::middleware('can:storefront.manage')->group(function () {
        Route::post('documents', [BuilderDocumentController::class, 'store']);
        Route::patch('documents/{document}', [BuilderDocumentController::class, 'rename'])->whereUuid('document');
        // B2: canvas data for unsaved elements and media (validated per element).
        Route::post('resolve', [BuilderDocumentController::class, 'resolve']);
        Route::put('documents/{document}/draft', [BuilderDocumentController::class, 'saveDraft'])->whereUuid('document');
        Route::post('documents/{document}/publish', [BuilderDocumentController::class, 'publish'])->whereUuid('document')->middleware('can:storefront.publish');
        Route::post('documents/{document}/discard', [BuilderDocumentController::class, 'discard'])->whereUuid('document');
        Route::post('documents/{document}/versions/{version}/restore', [BuilderDocumentController::class, 'restore'])
            ->whereUuid(['document', 'version'])->scopeBindings();
        Route::delete('documents/{document}', [BuilderDocumentController::class, 'destroy'])->whereUuid('document');
        // A banner of the page, edited in place or copied when anything else shows it (copy-on-write).
        Route::post('documents/{document}/banners/{banner}', [BuilderDocumentController::class, 'editBanner'])->whereUuid(['document', 'banner']);
        // B5: templates — apply (built-in id or own uuid), save a section, delete an own one.
        Route::post('templates/{template}/instantiate', [BuilderTemplateController::class, 'instantiate'])
            ->where('template', '[A-Za-z0-9-]{2,80}')->middleware('throttle:builder-templates');
        Route::post('templates', [BuilderTemplateController::class, 'store']);
        Route::delete('templates/{template}', [BuilderTemplateController::class, 'destroy'])->whereUuid('template');
        // B5: a demo look into drafts only (no storefront.publish needed), then publish them together.
        Route::post('start-from-demo/{preset}', [BuilderTemplateController::class, 'startFromDemo'])
            ->whereIn('preset', ['vegan', 'handmade', 'classic', 'kids'])->middleware('throttle:builder-templates');
        Route::post('publish-all', [BuilderTemplateController::class, 'publishAll'])->middleware('can:storefront.publish');
    });
});
