<?php

use App\Modules\Organizations\Presentation\Http\Middleware\EnsurePlatformAdmin;
use App\Modules\Organizations\Presentation\Http\Middleware\ResolveTenant;
use App\Modules\Shared\Infrastructure\Exceptions\ApiExceptionRenderer;
use App\Modules\Shared\Infrastructure\Http\Middleware\AssignRequestId;
use App\Modules\Shared\Infrastructure\Http\Middleware\EnsureIdempotency;
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
        // Sanctum SPA cookie authentication for first-party frontends (SANCTUM_STATEFUL_DOMAINS).
        $middleware->statefulApi();
        $middleware->throttleApi();

        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'platform' => EnsurePlatformAdmin::class,
            'idempotent' => EnsureIdempotency::class,
        ]);

        // Tenant must be resolved before route-model binding so bound models are tenant-scoped.
        $middleware->prependToPriorityList(SubstituteBindings::class, ResolveTenant::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(new ApiExceptionRenderer);
    })->create();
