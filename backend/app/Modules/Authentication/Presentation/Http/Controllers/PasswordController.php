<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\ChangePassword;
use App\Modules\Authentication\Application\Actions\ResetPassword;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rules\Password;

class PasswordController
{
    /**
     * Request a password reset link
     *
     * Always succeeds, whether or not the e-mail exists.
     *
     * @unauthenticated
     */
    public function forgot(Request $request, ResetPassword $reset): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'string', 'email', 'max:255']]);
        $reset->sendLink($data['email']);

        return ApiResponse::success(['message' => 'If the address belongs to an account, a reset link has been sent.']);
    }

    /**
     * Reset password with an e-mailed token
     *
     * @unauthenticated
     */
    public function reset(Request $request, ResetPassword $reset): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ]);
        $reset->reset($data['email'], $data['token'], $data['password']);

        return ApiResponse::success(['message' => 'Your password has been reset. You can now sign in.']);
    }

    /**
     * Change own password
     *
     * Signs out all other sessions and devices.
     */
    public function change(Request $request, ChangePassword $changePassword): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string', 'current_password:sanctum'],
            'password' => ['required', 'string', 'confirmed', 'different:current_password', Password::defaults()],
        ]);

        /** @var User $user */
        $user = $request->user();
        $changePassword($user, $data['password'], $request->hasSession() ? $request->session()->getId() : null);

        return ApiResponse::noContent();
    }
}
