<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\ManagePin;
use App\Modules\Authentication\Application\Actions\PinSignIn;
use App\Modules\Authentication\Application\Services\PinCredentials;
use App\Modules\Authentication\Domain\Pin\PinRules;
use App\Modules\Authentication\Presentation\Http\Resources\CurrentUserResource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POS1a: till PINs — the user's own PIN (profile), sign-in with a PIN at a till and the
 * screen unlock of the POS.
 */
class PinController
{
    /**
     * Set or change own till PIN
     *
     * 4–6 digits, not one digit repeated and not a straight run (1234, 4321). Needs the current
     * password. Ends a PIN lockout.
     */
    public function update(Request $request, ManagePin $pins): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string', 'current_password:sanctum'],
            'pin' => ['required', 'string', 'max:'.PinRules::MAX_LENGTH],
        ]);
        $pins->set($this->user($request), $data['pin']);

        return ApiResponse::noContent();
    }

    /**
     * Remove own till PIN
     */
    public function destroy(Request $request, ManagePin $pins): JsonResponse
    {
        $request->validate(['current_password' => ['required', 'string', 'current_password:sanctum']]);
        $pins->remove($this->user($request));

        return ApiResponse::noContent();
    }

    /**
     * Sign in with a till PIN
     *
     * Only on a device set up as a till (the `pos_terminal` cookie); `user_id` is one of the users
     * of `GET /pos/terminal`. Answers like `POST /auth/login`. Replaces the session of another user
     * signed in on the device (switch cashier). Errors: `TERMINAL_NOT_FOUND` (404), `PIN_INVALID`
     * (`details.attempts_left`), `PIN_LOCKED` (423, `details.retry_after` seconds), `PIN_NOT_SET`,
     * `PIN_NOT_ALLOWED` (two-factor sign-in: use the password), `ACCOUNT_LOCKED`, `ACCOUNT_INACTIVE`,
     * 403 for a user who may not sell at this till.
     *
     * @unauthenticated
     */
    public function signIn(Request $request, PinSignIn $signIn): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required', 'uuid'],
            'pin' => ['required', 'string', 'max:'.PinRules::MAX_LENGTH],
        ]);

        return ApiResponse::success(new CurrentUserResource($signIn($data['user_id'], $data['pin'])));
    }

    /**
     * Check own till PIN (unlock the screen)
     *
     * Same lockout and errors as the PIN sign-in.
     */
    public function verify(Request $request, PinCredentials $pins): JsonResponse
    {
        $data = $request->validate(['pin' => ['required', 'string', 'max:'.PinRules::MAX_LENGTH]]);
        $pins->check($this->user($request), $data['pin']);

        return ApiResponse::noContent();
    }

    private function user(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }
}
