<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Application\Contracts\GuestCartMerger;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Sign-in and sign-out of the `customer` guard (ADR-002).
 *
 * Signing in regenerates the session id (fixation) and merges the visitor's guest cart.
 * Signing out forgets only the customer: the session itself is kept (a staff member may be
 * signed in to the same browser) and just gets a new CSRF token.
 */
class CustomerSession
{
    public const INVALID_MESSAGE = 'The e-mail address or password is incorrect.';

    private static ?string $dummyHash = null;

    public function __construct(
        private readonly Request $request,
        private readonly GuestCartMerger $carts,
        private readonly OnlineCustomerProfiles $customers,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * Checks the credentials; unknown e-mail, wrong password and disabled accounts all fail
     * with the same INVALID_CREDENTIALS answer.
     *
     * @return array{0: CustomerAccount, 1: array{merged_lines: int, capped_lines: int}}
     */
    public function attempt(string $email, string $password, bool $remember): array
    {
        /** @var CustomerAccount|null $account */
        $account = CustomerAccount::query()->whereRaw('lower(email) = ?', [mb_strtolower(trim($email))])->first();

        // Hash something either way so response times do not tell whether the e-mail exists.
        $valid = Hash::check($password, $account?->password ?? (self::$dummyHash ??= Hash::make(Str::random(32))));
        if ($account === null || ! $valid || ! $account->isActive() || ! $this->customers->isUsable($account->customer_id)) {
            throw new BusinessRuleViolation('INVALID_CREDENTIALS', self::INVALID_MESSAGE);
        }

        if (Hash::needsRehash($account->password)) {
            $account->forceFill(['password' => $password])->save();
        }

        return [$account, $this->login($account, $remember)];
    }

    /**
     * @return array{merged_lines: int, capped_lines: int}
     */
    public function login(CustomerAccount $account, bool $remember = false): array
    {
        if (! $this->request->hasSession()) {
            throw new BusinessRuleViolation('SESSION_UNAVAILABLE', 'Signing in needs a browser session.');
        }

        Auth::guard('customer')->login($account, $remember);
        $this->request->session()->regenerate();
        // E12b: the storefront language of this sign-up / sign-in (`lang`), for e-mails (E13).
        $account->forceFill(['last_login_at' => now(), 'preferred_locale' => $this->locale->current()])->save();

        return $this->carts->mergeGuestCart($account->customer_id);
    }

    public function logout(): void
    {
        Auth::guard('customer')->logout();
        if ($this->request->hasSession()) {
            // Never invalidate(): that would also sign out a staff user of this browser.
            $this->request->session()->regenerateToken();
        }
    }
}
