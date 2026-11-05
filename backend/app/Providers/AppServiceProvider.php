<?php

namespace App\Providers;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Export\BrowsershotPdfRenderer;
use App\Modules\Shared\Infrastructure\Export\ChromeLocator;
use App\Modules\Shared\Infrastructure\Html\PurifierHtmlSanitizer;
use App\Modules\Shared\Infrastructure\Sequences\DatabaseSequenceGenerator;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
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
        // E12b: the storefront language of this request (base language outside the storefront).
        $this->app->scoped(LocaleContext::class);
        $this->app->singleton(PermissionRegistry::class);
        $this->app->bind(SequenceGenerator::class, DatabaseSequenceGenerator::class);
        // X1: list exports render PDFs with headless Chrome (config/pdf.php).
        $this->app->bind(PdfRenderer::class, fn () => new BrowsershotPdfRenderer(ChromeLocator::fromConfig()));
        // Rich-text images may only come from the media disk (same-origin /storage locally, the CDN URL otherwise).
        $this->app->singleton(HtmlSanitizer::class, function () {
            $disk = (string) config('media.disk');

            return new PurifierHtmlSanitizer($disk === 'public' ? ['/storage/'] : [rtrim(Storage::disk($disk)->url(''), '/').'/']);
        });
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
            Limit::perMinute((int) config('pos.auth_rate_limit'))->by(mb_strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(4 * (int) config('pos.auth_rate_limit'))->by($request->ip()),
        ]);
    }
}
