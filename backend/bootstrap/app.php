<?php

use App\Modules\Authentication\Presentation\Http\Middleware\EnsureTwoFactorSetup;
use App\Modules\CustomerAccounts\Presentation\Http\Middleware\EnsureCustomerIsActive;
use App\Modules\Organizations\Presentation\Http\Middleware\EnsurePlatformAdmin;
use App\Modules\Organizations\Presentation\Http\Middleware\ResolveTenant;
use App\Modules\Shared\Infrastructure\Exceptions\ApiExceptionRenderer;
use App\Modules\Shared\Infrastructure\Http\Middleware\AssignRequestId;
use App\Modules\Shared\Infrastructure\Http\Middleware\EnsureIdempotency;
use App\Modules\Shared\Infrastructure\Http\Middleware\SecurityHeaders;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use App\Modules\Storefront\Presentation\Http\Middleware\StartStorefrontSession;
use App\Modules\Storefront\Presentation\Http\Middleware\StorefrontHttpCache;
use App\Modules\System\Infrastructure\ErrorLog\ErrorRecorder;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->prepend(AssignRequestId::class);
        // G1a: nosniff, referrer and permissions policy, HSTS, framing / CSP (never overwrites a route's own).
        $middleware->append(SecurityHeaders::class);
        // Sanctum SPA cookie authentication for first-party frontends (SANCTUM_STATEFUL_DOMAINS).
        $middleware->statefulApi();
        $middleware->throttleApi();
        // E12b: the storefront's language switcher writes `lang` in the browser (plain text).
        // BD1c: the Meta / TikTok pixels' first-party cookies (read at checkout for the click ids).
        $middleware->encryptCookies(except: ['lang', '_fbp', '_fbc', '_ttp']);

        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'platform' => EnsurePlatformAdmin::class,
            'idempotent' => EnsureIdempotency::class,
            'storefront' => ResolveStorefront::class,
            'storefront.session' => StartStorefrontSession::class,
            'storefront.cache' => StorefrontHttpCache::class,
            'customer.active' => EnsureCustomerIsActive::class,
        ]);

        // Tenant must be resolved before route-model binding so bound models are tenant-scoped.
        $middleware->prependToPriorityList(SubstituteBindings::class, ResolveTenant::class);
        // The storefront's organization (from the host) and its session come before
        // authentication (auth:customer looks accounts up inside that organization), throttling
        // and route-model binding.
        $middleware->prependToPriorityList(AuthenticatesRequests::class, ResolveStorefront::class);
        $middleware->prependToPriorityList(AuthenticatesRequests::class, StartStorefrontSession::class);

        // G1a: staff routes (auth:sanctum) answer 403 TWO_FACTOR_SETUP_REQUIRED while the organization
        // requires two-factor sign-in that the user has not set up; ordered right after authentication.
        $middleware->api(append: [EnsureTwoFactorSetup::class]);
        $middleware->appendToPriorityList(AuthenticatesRequests::class, EnsureTwoFactorSetup::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(new ApiExceptionRenderer);
        // G1b: unexpected errors also go to the built-in error log (normal logging continues).
        $exceptions->report(function (Throwable $e): void {
            ErrorRecorder::report($e);
        });
    })->create();
