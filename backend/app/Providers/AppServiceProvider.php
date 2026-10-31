<?php

namespace App\Providers;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Sequences\DatabaseSequenceGenerator;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Per request (and per queued job / Octane request): never leaks between tenants.
        $this->app->scoped(TenantContext::class);
        $this->app->singleton(PermissionRegistry::class);
        $this->app->bind(SequenceGenerator::class, DatabaseSequenceGenerator::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Fail loudly in development on lazy loading, unknown attributes and silently discarded fills.
        Model::shouldBeStrict(! $this->app->isProduction());

        RateLimiter::for('api', fn (Request $request) => Limit::perMinute((int) config('pos.api_rate_limit'))
            ->by($request->user()?->getAuthIdentifier() ?: $request->ip()));

        // Credential endpoints: per account+IP and per IP, to slow down guessing and enumeration.
        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(5)->by(mb_strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(20)->by($request->ip()),
        ]);
    }
}
