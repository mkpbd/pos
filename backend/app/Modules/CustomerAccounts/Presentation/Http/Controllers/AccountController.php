<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Application\Actions\CreateCustomerAccount;
use App\Modules\CustomerAccounts\Application\Actions\CustomerProfile;
use App\Modules\CustomerAccounts\Application\Actions\CustomerSession;
use App\Modules\CustomerAccounts\Application\Actions\EmailVerification;
use App\Modules\CustomerAccounts\Application\Actions\PasswordResets;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Presentation\Http\Requests\RegisterCustomerRequest;
use App\Modules\CustomerAccounts\Presentation\Http\Requests\UpdateProfileRequest;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rules\Password;

/**
 * The shopper's store account: sign-up, sign-in, e-mail verification, password reset,
 * profile and password (organization from the host name, `customer` guard).
 */
class AccountController
{
    /**
     * Current shopper
     *
     * The signed-in shopper, or `null` for guests (always 200). Issues the session and
     * XSRF-TOKEN cookies the SPA needs for its first unsafe request.
     */
    public function me(CustomerProfile $profile): JsonResponse
    {
        $account = Auth::guard('customer')->user();

        return ApiResponse::success($account instanceof CustomerAccount ? $profile->show($account) : null);
    }

    /**
     * Create an account
     *
     * Always creates a new customer record and signs the shopper in; the guest cart is merged
     * into the new account's cart. A confirmation e-mail is sent.
     */
    public function register(RegisterCustomerRequest $request, CreateCustomerAccount $create, CustomerSession $session, EmailVerification $verification, CustomerProfile $profile): JsonResponse
    {
        $account = $create($request->validated());
        $merge = $session->login($account);
        $verification->send($account, $request->getSchemeAndHttpHost());

        return ApiResponse::created(['customer' => $profile->show($account), 'merge' => $merge]);
    }

    /**
     * Sign in
     *
     * `INVALID_CREDENTIALS` for a wrong e-mail/password pair and for disabled accounts alike.
     * The guest cart is merged into the account's cart (`merge`).
     */
    public function login(Request $request, CustomerSession $session, CustomerProfile $profile): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'max:254'],
            'password' => ['required', 'string', 'max:255'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        [$account, $merge] = $session->attempt($data['email'], $data['password'], $request->boolean('remember'));

        return ApiResponse::success(['customer' => $profile->show($account), 'merge' => $merge]);
    }

    /**
     * Sign out
     *
     * Ends the shopper's sign-in only; a staff session in the same browser is kept.
     */
    public function logout(CustomerSession $session): JsonResponse
    {
        $session->logout();

        return ApiResponse::noContent();
    }

    /**
     * Forgot password
     *
     * Always the same answer, whether or not an account uses the address.
     */
    public function forgotPassword(Request $request, PasswordResets $resets): JsonResponse
    {
        $email = $request->validate(['email' => ['required', 'string', 'email:rfc', 'max:254']])['email'];
        $resets->request($email, $request->getSchemeAndHttpHost());

        return ApiResponse::success(['message' => 'If an account uses this e-mail address, we have sent it a link to reset the password.']);
    }

    /**
     * Reset password
     *
     * With the token from the e-mail; signs the shopper in and merges the guest cart. Any wrong,
     * expired or unknown e-mail/token pair is the same 422 field error on `token`.
     */
    public function resetPassword(Request $request, PasswordResets $resets, CustomerSession $session, CustomerProfile $profile): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'string', 'max:254'],
            'token' => ['required', 'string', 'max:200'],
            'password' => ['required', 'string', 'confirmed', 'max:255', Password::defaults()],
        ]);
        $account = $resets->reset($data['email'], $data['token'], $data['password']);
        $merge = $session->login($account);

        return ApiResponse::success(['customer' => $profile->show($account), 'merge' => $merge]);
    }

    /**
     * Confirm e-mail address
     *
     * With the token from the confirmation e-mail (valid 24 hours). `TOKEN_INVALID` otherwise.
     */
    public function verifyEmail(Request $request, EmailVerification $verification): JsonResponse
    {
        $verification->verify($request->validate(['token' => ['required', 'string', 'max:100']])['token']);

        return ApiResponse::success(['message' => 'Your e-mail address is confirmed.']);
    }

    /**
     * Resend confirmation e-mail
     */
    public function resendVerification(Request $request, EmailVerification $verification): JsonResponse
    {
        /** @var CustomerAccount $account */
        $account = $request->user('customer');
        $verification->send($account, $request->getSchemeAndHttpHost());

        return ApiResponse::success(['message' => $account->email_verified_at === null
            ? 'We have sent a new confirmation link to your e-mail address.'
            : 'Your e-mail address is already confirmed.']);
    }

    /**
     * Profile
     */
    public function profile(Request $request, CustomerProfile $profile): JsonResponse
    {
        return ApiResponse::success($profile->show($request->user('customer')));
    }

    /**
     * Update profile
     *
     * Name and (Bangladeshi mobile) phone. The e-mail address cannot be changed yet.
     */
    public function updateProfile(UpdateProfileRequest $request, CustomerProfile $profile): JsonResponse
    {
        $data = $request->validated();

        return ApiResponse::success($profile->update($request->user('customer'), $data['name'], $data['phone'] ?? null));
    }

    /**
     * Change password
     *
     * A wrong `current_password` is a field error.
     */
    public function changePassword(Request $request, CustomerProfile $profile): JsonResponse
    {
        $data = $request->validate([
            'current_password' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'confirmed', 'max:255', Password::defaults()],
        ]);
        $profile->changePassword($request->user('customer'), $data['current_password'], $data['password']);

        return ApiResponse::success(['message' => 'Your password has been changed.']);
    }
}
