<?php

use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Presentation\Http\Controllers\BannerController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderAiController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderCollaborationController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderDocumentController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderExperimentController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderPortabilityController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderPublishingController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderReviewController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderTemplateController;
use App\Modules\Storefront\Presentation\Http\Controllers\BuilderWizardController;
use App\Modules\Storefront\Presentation\Http\Controllers\CustomFontController;
use App\Modules\Storefront\Presentation\Http\Controllers\DemoGalleryController;
use App\Modules\Storefront\Presentation\Http\Controllers\FestivalController;
use App\Modules\Storefront\Presentation\Http\Controllers\FormSubmissionController;
use App\Modules\Storefront\Presentation\Http\Controllers\HomepageSectionController;
use App\Modules\Storefront\Presentation\Http\Controllers\LinkTargetController;
use App\Modules\Storefront\Presentation\Http\Controllers\MenuController;
use App\Modules\Storefront\Presentation\Http\Controllers\RedirectController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreBootstrapController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreBuilderPageController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreBuilderPopupsController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreFormController;
use App\Modules\Storefront\Presentation\Http\Controllers\StorefrontAdminController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreHomepageController;
use App\Modules\Storefront\Presentation\Http\Controllers\StoreRedirectController;
use App\Modules\Storefront\Presentation\Http\Controllers\ThemeDraftController;
use App\Modules\Storefront\Presentation\Http\Middleware\EnsureBuilderEditLock;
use Illuminate\Support\Facades\Route;

// Public storefront API: organization from the host name, no authentication.
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    // The session cookies (and XSRF-TOKEN) start here so the SPA's first unsafe request passes CSRF.
    Route::get('bootstrap', StoreBootstrapController::class)->middleware(['storefront.session', 'storefront.cache'])->name('store.bootstrap');
    Route::get('homepage', StoreHomepageController::class)->middleware('storefront.cache')->name('store.homepage');
    // B1: published store builder pages — `home` or a landing page slug (`?preview=draft` for staff).
    Route::get('builder/pages/{slug}', StoreBuilderPageController::class)->middleware('storefront.cache')
        ->where('slug', '[a-z0-9-]{2,60}')->name('store.builder-page');
    // B14: published store page templates (shop, category, … `?preview=draft` for staff).
    Route::get('builder/templates/{template}', [StoreBuilderPageController::class, 'template'])->middleware('storefront.cache')
        ->whereIn('template', ElementRegistry::TEMPLATES)->name('store.builder-template');
    // B8b: live popups and bars (`?preview=draft&popup=<id>` for staff).
    Route::get('builder/popups', StoreBuilderPopupsController::class)->middleware('storefront.cache')->name('store.builder-popups');
    // B8b: a visitor sends a builder form (published documents only).
    Route::post('forms/{document}/{element}', [StoreFormController::class, 'submit'])
        ->whereUuid('document')->where('element', '[a-z][a-z0-9_-]{1,31}')->middleware('throttle:forms')->name('store.form-submit');
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
        // B10: the store's own fonts.
        Route::get('fonts', [CustomFontController::class, 'index']);
        Route::get('menus', [MenuController::class, 'index']);
        Route::get('menus/{menu}', [MenuController::class, 'show'])->whereUuid('menu');
        Route::get('link-targets', LinkTargetController::class);
        Route::get('banners', [BannerController::class, 'index']);
        Route::get('banners/{banner}', [BannerController::class, 'show'])->whereUuid('banner');
        Route::get('homepage-sections', [HomepageSectionController::class, 'index']);
        Route::get('homepage-sections/types', [HomepageSectionController::class, 'types']);
        Route::get('homepage-sections/{section}', [HomepageSectionController::class, 'show'])->whereUuid('section');
        // B17: the festival calendar.
        Route::get('festivals', [FestivalController::class, 'index']);
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
        // B11: publish the theme draft later.
        Route::post('theme/schedule', [ThemeDraftController::class, 'schedule'])->middleware('can:storefront.publish');
        Route::delete('theme/schedule', [ThemeDraftController::class, 'cancelSchedule'])->middleware('can:storefront.publish');
        Route::post('theme/discard', [ThemeDraftController::class, 'discard']);
        Route::post('theme/versions/{version}/restore', [ThemeDraftController::class, 'restore'])->whereUuid('version');
        // B3: applies to the draft.
        Route::post('theme/presets/{preset}/apply', [ThemeDraftController::class, 'applyPreset'])->whereIn('preset', ThemePresets::KEYS);
        Route::post('fonts', [CustomFontController::class, 'store']);
        Route::delete('fonts/{font}', [CustomFontController::class, 'destroy'])->whereUuid('font');
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
        // B17: one-click festival setup (drafts only).
        Route::post('festivals/{key}/setup', [FestivalController::class, 'setup'])->where('key', '[a-z0-9-]{2,40}');
    });

    Route::put('theme/custom-css', [StorefrontAdminController::class, 'updateCustomCss'])->middleware('can:storefront.custom_css');
});

// B8b: what visitors sent with builder forms.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('forms')->group(function () {
    Route::middleware('can:forms.view')->group(function () {
        Route::get('/', [FormSubmissionController::class, 'forms']);
        Route::get('submissions', [FormSubmissionController::class, 'index']);
        Route::get('submissions/{submission}', [FormSubmissionController::class, 'show'])->whereUuid('submission');
    });
    Route::middleware('can:forms.manage')->group(function () {
        Route::patch('submissions/{submission}', [FormSubmissionController::class, 'update'])->whereUuid('submission');
        Route::delete('submissions/{submission}', [FormSubmissionController::class, 'destroy'])->whereUuid('submission');
    });
});

// B1: the visual store builder — documents with draft / publish / versions.
Route::middleware(['auth:sanctum', 'tenant'])->prefix('storefront/builder')->group(function () {
    Route::middleware('can:storefront.view')->group(function () {
        Route::get('elements', [BuilderDocumentController::class, 'elements']);
        Route::get('documents', [BuilderDocumentController::class, 'index']);
        // B9: global sections with where they are used.
        Route::get('globals', [BuilderDocumentController::class, 'globals']);
        Route::get('documents/{document}', [BuilderDocumentController::class, 'show'])->whereUuid('document');
        Route::get('documents/{document}/versions', [BuilderDocumentController::class, 'versions'])->whereUuid('document');
        Route::get('documents/{document}/render', [BuilderDocumentController::class, 'render'])->whereUuid('document');
        // B11: a version's / checkpoint's render and the change list between two snapshots.
        Route::get('documents/{document}/versions/{version}/render', [BuilderPublishingController::class, 'renderVersion'])
            ->whereUuid(['document', 'version'])->scopeBindings();
        Route::get('documents/{document}/compare', [BuilderPublishingController::class, 'compare'])->whereUuid('document');
        // B2: the editor canvas — the store bootstrap of the staff member's own organization.
        Route::get('canvas-context', [BuilderDocumentController::class, 'canvasContext']);
        // B14: the page context a store page template is designed with (orders masked).
        Route::get('sample-context', [BuilderDocumentController::class, 'sampleContext']);
        // B5: built-in and own templates (no content).
        Route::get('templates', [BuilderTemplateController::class, 'index']);
        // B16: presence (heartbeats; the edit lock), comments pinned on the page, the activity log.
        Route::post('documents/{document}/presence', [BuilderCollaborationController::class, 'heartbeat'])->whereUuid('document');
        Route::delete('documents/{document}/presence', [BuilderCollaborationController::class, 'leave'])->whereUuid('document');
        Route::get('documents/{document}/comments', [BuilderCollaborationController::class, 'comments'])->whereUuid('document');
        Route::post('documents/{document}/comments', [BuilderCollaborationController::class, 'storeComment'])->whereUuid('document');
        Route::patch('documents/{document}/comments/{comment}', [BuilderCollaborationController::class, 'updateComment'])->whereUuid(['document', 'comment']);
        Route::post('documents/{document}/comments/{comment}/resolve', [BuilderCollaborationController::class, 'resolveComment'])->whereUuid(['document', 'comment']);
        Route::post('documents/{document}/comments/{comment}/reopen', [BuilderCollaborationController::class, 'reopenComment'])->whereUuid(['document', 'comment']);
        Route::delete('documents/{document}/comments/{comment}', [BuilderCollaborationController::class, 'destroyComment'])->whereUuid(['document', 'comment']);
        Route::get('mentionable', [BuilderCollaborationController::class, 'mentionable']);
        Route::get('documents/{document}/activity', [BuilderCollaborationController::class, 'activity'])->whereUuid('document');
    });

    Route::middleware('can:storefront.manage')->group(function () {
        Route::post('documents', [BuilderDocumentController::class, 'store']);
        Route::patch('documents/{document}', [BuilderDocumentController::class, 'rename'])->whereUuid('document');
        // B2: canvas data for unsaved elements and media (validated per element).
        Route::post('resolve', [BuilderDocumentController::class, 'resolve']);
        Route::put('documents/{document}/draft', [BuilderDocumentController::class, 'saveDraft'])->whereUuid('document');
        // B12: one section into the drafts of several documents (never published).
        Route::post('sections/copy', [BuilderDocumentController::class, 'copySection']);
        // B10: page check before publish (nothing is saved).
        Route::post('documents/{document}/check', [BuilderDocumentController::class, 'check'])->whereUuid('document');
        Route::post('documents/{document}/publish', [BuilderDocumentController::class, 'publish'])->whereUuid('document')->middleware('can:storefront.publish');
        Route::post('documents/{document}/discard', [BuilderDocumentController::class, 'discard'])->whereUuid('document');
        // B14: "Use the standard page" — a store page design off the store (draft kept).
        Route::post('documents/{document}/unpublish', [BuilderDocumentController::class, 'unpublish'])->whereUuid('document')->middleware('can:storefront.publish');
        // B13: A/B tests — start, stop, keep a version (the draft; storefront.publish).
        Route::middleware(['can:storefront.publish', EnsureBuilderEditLock::class])->group(function () {
            foreach (['start', 'stop', 'keep'] as $action) {
                Route::post("documents/{document}/experiments/{experiment}/{$action}", [BuilderExperimentController::class, $action])
                    ->whereUuid('document')->where('experiment', '[a-z][a-z0-9_-]{1,31}');
            }
        });
        // B16: the edit lock — take over (storefront.publish while the lease is live), ask to edit.
        Route::post('documents/{document}/lock/take-over', [BuilderCollaborationController::class, 'takeOver'])->whereUuid('document');
        Route::post('documents/{document}/lock/request', [BuilderCollaborationController::class, 'requestEdit'])->whereUuid('document');
        Route::post('documents/{document}/versions/{version}/restore', [BuilderDocumentController::class, 'restore'])
            ->whereUuid(['document', 'version'])->scopeBindings();
        Route::delete('documents/{document}', [BuilderDocumentController::class, 'destroy'])->whereUuid('document');
        // B11: publish later (storefront.publish), draft checkpoints and version names, reviews.
        Route::post('documents/{document}/schedule', [BuilderPublishingController::class, 'schedule'])->whereUuid('document')->middleware(['can:storefront.publish', EnsureBuilderEditLock::class]);
        Route::delete('documents/{document}/schedule', [BuilderPublishingController::class, 'cancelSchedule'])->whereUuid('document')->middleware(['can:storefront.publish', EnsureBuilderEditLock::class]);
        Route::post('documents/{document}/checkpoints', [BuilderPublishingController::class, 'checkpoint'])->whereUuid('document')->middleware(EnsureBuilderEditLock::class);
        Route::patch('documents/{document}/versions/{version}', [BuilderPublishingController::class, 'renameVersion'])
            ->whereUuid(['document', 'version'])->scopeBindings();
        Route::delete('documents/{document}/versions/{version}', [BuilderPublishingController::class, 'deleteVersion'])
            ->whereUuid(['document', 'version'])->scopeBindings();
        Route::post('documents/{document}/reviews', [BuilderPublishingController::class, 'submitReview'])->whereUuid('document')->middleware(EnsureBuilderEditLock::class);
        Route::get('reviews', [BuilderReviewController::class, 'index']);
        Route::get('reviews/{review}', [BuilderReviewController::class, 'show'])->whereUuid('review');
        Route::post('reviews/{review}/approve', [BuilderReviewController::class, 'approve'])->whereUuid('review')->middleware('can:storefront.publish');
        Route::post('reviews/{review}/send-back', [BuilderReviewController::class, 'sendBack'])->whereUuid('review')->middleware('can:storefront.publish');
        Route::post('reviews/{review}/withdraw', [BuilderReviewController::class, 'withdraw'])->whereUuid('review');
        // A banner of the page, edited in place or copied when anything else shows it (copy-on-write).
        Route::post('documents/{document}/banners/{banner}', [BuilderDocumentController::class, 'editBanner'])->whereUuid(['document', 'banner'])->middleware(EnsureBuilderEditLock::class);
        // B5: templates — apply (built-in id or own uuid), save a section, delete an own one.
        Route::post('templates/{template}/instantiate', [BuilderTemplateController::class, 'instantiate'])
            ->where('template', '[A-Za-z0-9-]{2,80}')->middleware('throttle:builder-templates');
        Route::post('templates', [BuilderTemplateController::class, 'store']);
        Route::delete('templates/{template}', [BuilderTemplateController::class, 'destroy'])->whereUuid('template');
        // B5: a demo look into drafts only (no storefront.publish needed), then publish them together.
        Route::post('start-from-demo/{preset}', [BuilderTemplateController::class, 'startFromDemo'])
            ->whereIn('preset', ['default', 'vegan', 'handmade', 'classic', 'kids', 'fashion', 'electronics', 'grocery', 'beauty', 'furniture'])->middleware('throttle:builder-templates');
        Route::post('publish-all', [BuilderTemplateController::class, 'publishAll'])->middleware('can:storefront.publish');
        // B21: "Build my page in 1 minute" — a draft from the built-in templates (never published).
        Route::post('wizard', BuilderWizardController::class)->middleware('throttle:builder-templates');
        // B9: the AI writer (through the AI module's gate and budget; nothing is saved).
        Route::post('ai/write', BuilderAiController::class)->middleware('throttle:builder-ai');
    });
});

// B16: where an old address went (the storefront's 404 page asks; public, HTTP-cached).
Route::middleware(['storefront', 'throttle:storefront'])->prefix('store')->group(function () {
    Route::get('redirects/resolve', StoreRedirectController::class)->middleware('storefront.cache')->name('store.redirect-resolve');
});

// B16: export / import of builder pages, a landing page's new address, and the store's redirects.
Route::middleware(['auth:sanctum', 'tenant', 'can:storefront.manage'])->prefix('storefront')->group(function () {
    Route::get('builder/documents/{document}/export', [BuilderPortabilityController::class, 'export'])->whereUuid('document');
    Route::post('builder/import', [BuilderPortabilityController::class, 'import'])->middleware('throttle:builder-templates');
    Route::post('builder/documents/{document}/address', [BuilderPortabilityController::class, 'changeAddress'])->whereUuid('document');
    Route::get('redirects', [RedirectController::class, 'index']);
    Route::get('redirects/test', [RedirectController::class, 'test']);
    Route::post('redirects', [RedirectController::class, 'store']);
    Route::patch('redirects/{redirect}', [RedirectController::class, 'update'])->whereUuid('redirect');
    Route::delete('redirects/{redirect}', [RedirectController::class, 'destroy'])->whereUuid('redirect');
});
