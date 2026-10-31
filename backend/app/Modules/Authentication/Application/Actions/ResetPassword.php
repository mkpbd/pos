<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

/**
 * Password-reset flow (forgot → e-mailed link → reset). A successful reset
 * revokes every session and token of the user.
 */
class ResetPassword
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * Always reports success to the caller so it cannot be used to discover accounts.
     */
    public function sendLink(string $email): void
    {
        Password::broker()->sendResetLink(['email' => mb_strtolower(trim($email))]);
    }

    public function reset(string $email, string $token, string $password): void
    {
        $status = Password::broker()->reset(
            ['email' => mb_strtolower(trim($email)), 'token' => $token, 'password' => $password],
            function (User $user, string $password) {
                $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)])->save();
                $user->tokens()->delete();
                DB::table('sessions')->where('user_id', $user->id)->delete();

                event(new PasswordReset($user));
                $this->audit->record('auth.password_reset', $user);
            },
        );

        if ($status !== Password::PASSWORD_RESET) {
            throw new BusinessRuleViolation('INVALID_RESET_TOKEN', 'This password reset link is invalid or has expired.');
        }
    }
}
