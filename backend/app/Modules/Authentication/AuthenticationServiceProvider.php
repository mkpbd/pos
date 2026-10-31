<?php

namespace App\Modules\Authentication;

use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Validation\Rules\Password;

/**
 * Login/logout (SPA sessions and device tokens), registration, password flows, login activity.
 */
class AuthenticationServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        parent::boot();

        // Reset links point to the admin SPA (served under /admin), which posts the token back to /api/v1/auth/reset-password.
        ResetPassword::createUrlUsing(fn ($user, string $token) => rtrim((string) config('pos.frontend_url'), '/')
            .'/admin/reset-password?'.http_build_query(['token' => $token, 'email' => $user->getEmailForPasswordReset()]));

        Password::defaults(fn () => $this->app->isProduction()
            ? Password::min(10)->letters()->mixedCase()->numbers()->uncompromised()
            : Password::min(8)->letters()->numbers());
    }
}
