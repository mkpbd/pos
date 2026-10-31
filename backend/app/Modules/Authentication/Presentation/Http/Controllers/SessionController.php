<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\EndSession;
use App\Modules\Authentication\Application\Actions\StartSession;
use App\Modules\Authentication\Application\Actions\VerifyCredentials;
use App\Modules\Authentication\Presentation\Http\Requests\LoginRequest;
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
     *
     * @unauthenticated
     */
    public function login(LoginRequest $request, VerifyCredentials $verify, StartSession $startSession): JsonResponse
    {
        $user = $verify($request->validated('email'), $request->validated('password'), 'session');
        $startSession($user, $request->boolean('remember'));

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
