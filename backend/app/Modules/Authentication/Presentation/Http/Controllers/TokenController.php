<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\DeviceSignIn;
use App\Modules\Authentication\Presentation\Http\Requests\IssueTokenRequest;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Personal access tokens for devices and integrations.
 */
class TokenController
{
    /**
     * Issue a device token
     *
     * The plain-text token is returned once; send it as `Authorization: Bearer <token>`.
     * G1a: accounts with two-factor sign-in add `code` or `recovery_code` (missing: 422
     * `TWO_FACTOR_REQUIRED`; wrong: 422 `INVALID_TWO_FACTOR_CODE`); accounts the organization
     * requires it from who have not set it up get 403 `TWO_FACTOR_SETUP_REQUIRED`.
     *
     * @unauthenticated
     */
    public function store(IssueTokenRequest $request, DeviceSignIn $signIn): JsonResponse
    {
        $token = $signIn(
            $request->validated('email'),
            $request->validated('password'),
            $request->validated('device_name'),
            $request->validated('code'),
            $request->validated('recovery_code'),
        );

        return ApiResponse::created([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $token->accessToken->expires_at?->toIso8601String(),
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $current = $user->currentAccessToken();

        return ApiResponse::success($user->tokens()->latest()->get()->map(fn (PersonalAccessToken $token) => [
            'id' => $token->id,
            'name' => $token->name,
            'last_used_at' => $token->last_used_at?->toIso8601String(),
            'expires_at' => $token->expires_at?->toIso8601String(),
            'created_at' => $token->created_at?->toIso8601String(),
            'is_current' => $current instanceof PersonalAccessToken && $current->is($token),
        ])->values());
    }

    public function destroy(Request $request, string $tokenId, AuditTrail $audit): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $token = $user->tokens()->whereKey($tokenId)->first() ?? throw new NotFoundHttpException;

        $token->delete();
        $audit->record('auth.token_revoked', $user, context: ['token_id' => $token->id, 'device_name' => $token->name]);

        return ApiResponse::noContent();
    }
}
