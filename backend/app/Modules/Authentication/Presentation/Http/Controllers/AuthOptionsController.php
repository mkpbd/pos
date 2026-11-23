<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

class AuthOptionsController
{
    /**
     * Sign-in options
     *
     * What the sign-in screens may offer before anyone is signed in: whether public sign-up
     * (POST /auth/register) is open (`POS_REGISTRATION_ENABLED`, off by default).
     *
     * @unauthenticated
     */
    public function __invoke(): JsonResponse
    {
        return ApiResponse::success([
            'registration_enabled' => (bool) config('pos.registration_enabled'),
        ]);
    }
}
