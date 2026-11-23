<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Application\Actions\ManageTwoFactor;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * G1a: the signed-in user's own two-factor sign-in (authenticator app + recovery codes).
 * Reachable while the organization's policy still requires setting it up.
 */
class TwoFactorController
{
    /**
     * Two-factor status
     *
     * `{enabled, confirmed_at, required, recovery_codes_left, pending_setup}`.
     */
    public function show(Request $request, ManageTwoFactor $twoFactor): JsonResponse
    {
        return ApiResponse::success($twoFactor->status($this->user($request)));
    }

    /**
     * Start setup
     *
     * Returns a new secret and its `otpauth://` URI (for the QR code). Errors: `INVALID_PASSWORD`,
     * `TWO_FACTOR_ALREADY_ENABLED`.
     */
    public function setup(Request $request, ManageTwoFactor $twoFactor): JsonResponse
    {
        $data = $request->validate(['password' => ['required', 'string', 'max:255']]);

        return ApiResponse::success($twoFactor->setup($this->user($request), $data['password']));
    }

    /**
     * Confirm setup
     *
     * Turns two-factor sign-in on with the first code; returns the 10 recovery codes — the only
     * time they are shown. Errors: `TWO_FACTOR_NOT_STARTED`, `INVALID_TWO_FACTOR_CODE`.
     */
    public function confirm(Request $request, ManageTwoFactor $twoFactor): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:16']]);

        return ApiResponse::success(['recovery_codes' => $twoFactor->confirm($this->user($request), $data['code'])]);
    }

    /**
     * New recovery codes
     *
     * The old codes stop working. Errors: `INVALID_PASSWORD`, `TWO_FACTOR_NOT_ENABLED`.
     */
    public function regenerateRecoveryCodes(Request $request, ManageTwoFactor $twoFactor): JsonResponse
    {
        $data = $request->validate(['password' => ['required', 'string', 'max:255']]);

        return ApiResponse::success(['recovery_codes' => $twoFactor->regenerateRecoveryCodes($this->user($request), $data['password'])]);
    }

    /**
     * Turn off two-factor sign-in
     *
     * `code`: a code from the app or a recovery code. Errors: `TWO_FACTOR_REQUIRED_BY_POLICY`,
     * `INVALID_PASSWORD`, `INVALID_TWO_FACTOR_CODE`, `TWO_FACTOR_NOT_ENABLED`.
     */
    public function destroy(Request $request, ManageTwoFactor $twoFactor): JsonResponse
    {
        $data = $request->validate([
            'password' => ['required', 'string', 'max:255'],
            'code' => ['required', 'string', 'max:32'],
        ]);
        $twoFactor->disable($this->user($request), $data['password'], $data['code']);

        return ApiResponse::noContent();
    }

    private function user(Request $request): User
    {
        /** @var User */
        return $request->user();
    }
}
