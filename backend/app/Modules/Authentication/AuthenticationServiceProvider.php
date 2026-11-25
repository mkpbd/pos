<?php

namespace App\Modules\Authentication;

use App\Modules\Authentication\Application\Contracts\TillDevices;
use App\Modules\Authentication\Application\Contracts\TillPins;
use App\Modules\Authentication\Application\Services\PinCredentials;
use App\Modules\Authentication\Application\Services\TwoFactorPolicy;
use App\Modules\Authentication\Infrastructure\Devices\NoTillDevices;
use App\Modules\Shared\Application\Contracts\TwoFactorOverview;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\Rules\Password;

/**
 * Login/logout (SPA sessions and device tokens), registration, password flows, login activity,
 * two-factor sign-in and account lockout (G1a), till PINs (POS1a).
 */
class AuthenticationServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(TwoFactorOverview::class, TwoFactorPolicy::class);
        // POS1a: till PINs for the Pos module; the tills themselves come from the Pos module (default: none).
        $this->app->bind(TillPins::class, PinCredentials::class);
        $this->app->bindIf(TillDevices::class, NoTillDevices::class);
    }

    public function boot(): void
    {
        parent::boot();

        // Reset links point to the admin SPA (served under /admin), which posts the token back to /api/v1/auth/reset-password.
        ResetPassword::createUrlUsing(fn ($user, string $token) => rtrim((string) config('pos.frontend_url'), '/')
            .'/admin/reset-password?'.http_build_query(['token' => $token, 'email' => $user->getEmailForPasswordReset()]));

        // POS1a: PIN sign-in and screen unlock — 10 a minute per till device and per user.
        RateLimiter::for('till-pin', fn (Request $request) => [
            Limit::perMinute(10)->by('till-pin:device:'.($this->app->make(TillDevices::class)->deviceKey($request) ?? $request->ip())),
            Limit::perMinute(10)->by('till-pin:user:'.(is_string($request->input('user_id')) ? $request->input('user_id') : ($request->user()?->getAuthIdentifier() ?? $request->ip()))),
        ]);

        Password::defaults(fn () => $this->app->isProduction()
            ? Password::min(10)->letters()->mixedCase()->numbers()->uncompromised()
            : Password::min(8)->letters()->numbers());
    }
}
