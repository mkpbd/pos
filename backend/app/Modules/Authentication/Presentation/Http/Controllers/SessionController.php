<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\EndSession;
use App\Modules\Authentication\Application\Actions\SessionSignIn;
use App\Modules\Authentication\Presentation\Http\Requests\LoginRequest;
use App\Modules\Authentication\Presentation\Http\Requests\TwoFactorChallengeRequest;
use App\Modules\Authentication\Presentation\Http\Resources\CurrentUserResource;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SessionController
{
    /**
     * Log in (web app)
     *
     * Cookie-session login for the first-party SPA. Call `GET /sanctum/csrf-cookie` first.
     * G1a: for an account with two-factor sign-in the answer is `{two_factor_required: true}`
     * (not signed in yet) — continue with `POST /auth/two-factor-challenge` within 5 minutes.
     * A locked account gets 422 `ACCOUNT_LOCKED` (`error.details.retry_after_seconds`).
     *
     * @unauthenticated
     */
    public function login(LoginRequest $request, SessionSignIn $signIn): JsonResponse
    {
        $user = $signIn->attempt($request->validated('email'), $request->validated('password'), $request->boolean('remember'));

        return $user === null
            ? ApiResponse::success(['two_factor_required' => true])
            : ApiResponse::success(new CurrentUserResource($user));
    }

    /**
     * Complete a two-factor sign-in
     *
     * G1a: exactly one of `code` (6 digits from the authenticator app) or `recovery_code`.
     * Errors: `TWO_FACTOR_CHALLENGE_EXPIRED` (sign in again), `INVALID_TWO_FACTOR_CODE`
     * (5 wrong codes end the challenge), `ACCOUNT_LOCKED`.
     *
     * @unauthenticated
     */
    public function challenge(TwoFactorChallengeRequest $request, SessionSignIn $signIn): JsonResponse
    {
        $user = $signIn->challenge($request->validated('code'), $request->validated('recovery_code'));

        return ApiResponse::success(new CurrentUserResource($user));
    }

    public function logout(Request $request, EndSession $endSession): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $endSession($user);

        return ApiResponse::noContent();
    }

    /**
     * Current user
     *
     * Identity, organization, accessible branches, roles and effective permissions.
     */
    public function me(Request $request): JsonResponse
    {
        return ApiResponse::success(new CurrentUserResource($request->user()));
    }
}
