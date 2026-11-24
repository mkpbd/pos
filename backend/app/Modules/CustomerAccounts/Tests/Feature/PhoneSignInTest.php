<?php

namespace App\Modules\CustomerAccounts\Tests\Feature;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Infrastructure\Notifications\VerifyCustomerEmail;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Sms\Tests\Concerns\BuildsSms;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1a: shopper sign-in with a mobile number and an SMS code — new accounts, verified-phone
 * accounts only, disabled accounts, the proven-phone session, races, rate limits, store
 * isolation, verifying the profile's phone, adding an e-mail address once and the first password.
 */
class PhoneSignInTest extends TestCase
{
    use ActsAsShopper, BuildsOnlineCatalog, BuildsSms, RefreshDatabase;

    private const HOST = 'shop.example.test';

    private const PHONE = '01712345678';

    /** @var array<string, mixed> */
    private array $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSms();
        Http::preventStrayRequests();
        Notification::fake();
        config(['pos.auth_rate_limit' => 100]);
        $this->tenant = $this->store('Berry Kids', self::HOST);
    }

    /**
     * @return array<string, mixed>
     */
    private function store(string $name, string $host, bool $sms = true): array
    {
        $tenant = $this->openStore($name, $host);
        if ($sms) {
            $this->enableSms();
        }
        $this->asVisitor();

        return $tenant;
    }

    private function url(string $path, string $host = self::HOST): string
    {
        return "http://{$host}/api/v1/store/account/{$path}";
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function postTo(string $path, array $data = [], string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->url($path, $host), $data);
    }

    private function sendCode(string $phone = self::PHONE, string $purpose = 'login', string $host = self::HOST): string
    {
        $this->postTo('otp/send', ['phone' => $phone, 'purpose' => $purpose], $host)->assertStatus(202)
            ->assertJsonPath('data', ['resend_after' => 60, 'expires_in' => 300]);

        return (string) $this->lastCode();
    }

    /**
     * Signs up a new phone-only shopper (name, optional e-mail) and returns the profile.
     *
     * @return array<string, mixed>
     */
    private function phoneSignUp(string $phone = self::PHONE, ?string $email = null, string $host = self::HOST): array
    {
        $code = $this->sendCode($phone, 'login', $host);
        $this->postTo('otp/login', ['phone' => $phone, 'code' => $code], $host)->assertOk()
            ->assertJsonPath('data.status', 'needs_profile')->assertJsonPath('data.phone', $phone);

        return $this->postTo('otp/register', array_filter(['name' => 'Rina Akter', 'email' => $email]), $host)->assertCreated()->json('data');
    }

    private function wrongCode(string $code): string
    {
        return $code === '000000' ? '111111' : '000000';
    }

    public function test_a_new_shopper_signs_up_and_back_in_with_a_phone(): void
    {
        $this->browse('GET', $this->url('me'))->assertOk()->assertJsonPath('data', null);
        $code = $this->sendCode('+880 1712-345678');
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $this->wrongCode($code)])->assertStatus(422)->assertJsonPath('error.code', 'OTP_INVALID');
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $code])->assertOk()
            ->assertJsonPath('data', ['status' => 'needs_profile', 'phone' => self::PHONE]);
        $this->browse('GET', $this->url('me'))->assertOk()->assertJsonPath('data', null);

        $this->postTo('otp/register', ['name' => '', 'email' => 'not-an-email'])->assertStatus(422)->assertJsonValidationErrors(['name', 'email'], 'error.details');
        $profile = $this->postTo('otp/register', ['name' => 'Rina Akter', 'email' => 'Rina@Example.test'])->assertCreated()->json('data');

        $account = CustomerAccount::query()->withoutGlobalScopes()->sole();
        $this->assertSame([
            'id' => $account->id, 'name' => 'Rina Akter', 'email' => 'rina@example.test', 'phone' => self::PHONE,
            'email_verified' => false, 'phone_verified' => true, 'has_password' => false, 'preferred_locale' => 'en',
        ], $profile);
        $this->assertNull($account->password);
        $this->assertNotNull($account->phone_verified_at);
        Notification::assertSentTo($account, VerifyCustomerEmail::class);
        $customer = Customer::query()->withoutGlobalScopes()->findOrFail($account->customer_id);
        $this->assertSame(['Rina Akter', 'rina@example.test', self::PHONE], [$customer->name, $customer->email, $customer->phone]);
        $this->browse('GET', $this->url('me'))->assertOk()->assertJsonPath('data.phone_verified', true)->assertJsonPath('data.has_password', false);

        // The proven phone is used once: registering again needs a new code.
        $this->postTo('logout')->assertNoContent();
        $this->postTo('otp/register', ['name' => 'Again'])->assertStatus(422)->assertJsonPath('error.code', 'OTP_SESSION_EXPIRED');

        // Back in with a new code: the same account.
        $this->travel(61)->seconds();
        $code = $this->sendCode();
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $code, 'remember' => true])->assertOk()
            ->assertJsonPath('data.status', 'signed_in')
            ->assertJsonPath('data.customer.id', $account->id)
            ->assertJsonPath('data.customer.email', 'rina@example.test')
            ->assertJsonPath('data.merge', ['merged_lines' => 0, 'capped_lines' => 0]);
        $this->browse('GET', $this->url('profile'))->assertOk()->assertJsonPath('data.id', $account->id);
        $this->assertSame(1, CustomerAccount::query()->withoutGlobalScopes()->count());
    }

    public function test_a_phone_only_account_without_e_mail(): void
    {
        $profile = $this->phoneSignUp();
        $this->assertNull($profile['email']);
        $this->assertFalse($profile['email_verified']);
        Notification::assertNothingSent();
        $this->assertNull(CustomerAccount::query()->withoutGlobalScopes()->sole()->email);

        // Staff screens handle the missing e-mail address.
        $this->actingAsUser($this->tenant['admin']);
        $customerId = CustomerAccount::query()->withoutGlobalScopes()->sole()->customer_id;
        $this->getJson("/api/v1/customers/{$customerId}")->assertOk()->assertJsonPath('data.online_account.email', null)
            ->assertJsonPath('data.online_account.status', 'active');
    }

    public function test_an_unverified_account_with_the_number_is_never_signed_into(): void
    {
        $this->registerShopper(self::HOST, 'owner@example.test', extra: ['phone' => self::PHONE]);
        $this->clearBrowser();

        $this->phoneSignUp();

        $accounts = CustomerAccount::query()->withoutGlobalScopes()->orderBy('created_at')->get();
        $this->assertCount(2, $accounts);
        $this->assertNull($accounts[0]->phone_verified_at);
        $this->assertNotNull($accounts[1]->phone_verified_at);
        $this->browse('GET', $this->url('me'))->assertJsonPath('data.id', $accounts[1]->id);
    }

    public function test_a_disabled_account_cannot_sign_in(): void
    {
        $this->phoneSignUp();
        $this->clearBrowser();
        $customerId = CustomerAccount::query()->withoutGlobalScopes()->sole()->customer_id;
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson("/api/v1/customer-accounts/{$customerId}", ['status' => 'disabled'])->assertOk();
        $this->asVisitor();

        $this->travel(61)->seconds();
        $code = $this->sendCode();
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $code])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $this->browse('GET', $this->url('me'))->assertJsonPath('data', null);
        $this->assertSame(1, CustomerAccount::query()->withoutGlobalScopes()->count());
    }

    public function test_the_proven_phone_expires_after_fifteen_minutes(): void
    {
        $this->postTo('otp/register', ['name' => 'Rina'])->assertStatus(422)->assertJsonPath('error.code', 'OTP_SESSION_EXPIRED');

        $code = $this->sendCode();
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $code])->assertJsonPath('data.status', 'needs_profile');
        $this->travel(16)->minutes();
        $this->postTo('otp/register', ['name' => 'Rina'])->assertStatus(422)->assertJsonPath('error.code', 'OTP_SESSION_EXPIRED');
        $this->assertSame(0, CustomerAccount::query()->withoutGlobalScopes()->count());
    }

    public function test_a_phone_verified_meanwhile_is_in_use(): void
    {
        $code = $this->sendCode();
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $code])->assertJsonPath('data.status', 'needs_profile');
        $myJar = $this->jar;

        // Another browser completes an account for the same number first.
        $this->clearBrowser();
        $this->travel(61)->seconds();
        $this->phoneSignUp();

        $this->clearBrowser();
        $this->jar = $myJar;
        $this->postTo('otp/register', ['name' => 'Rina'])->assertStatus(409)->assertJsonPath('error.code', 'PHONE_IN_USE');
        $this->assertSame(1, CustomerAccount::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, Customer::query()->withoutGlobalScopes()->count());
    }

    public function test_guest_only_and_signed_in_only_codes(): void
    {
        $this->freezeTime();
        $this->postTo('otp/send', ['phone' => self::PHONE, 'purpose' => 'verify_phone'])->assertUnauthorized();
        $this->postTo('otp/send', ['phone' => '0123', 'purpose' => 'login'])->assertStatus(422)->assertJsonValidationErrors(['phone'], 'error.details');
        $this->postTo('otp/send', ['phone' => self::PHONE, 'purpose' => 'checkout'])->assertStatus(422)->assertJsonValidationErrors(['purpose'], 'error.details');

        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->postTo('otp/send', ['phone' => self::PHONE, 'purpose' => 'login'])->assertStatus(409)->assertJsonPath('error.code', 'ALREADY_SIGNED_IN');
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => '123456'])->assertStatus(409);
        $this->postTo('otp/register', ['name' => 'X'])->assertStatus(409);
        $this->sendCode(self::PHONE, 'verify_phone');

        // Too soon for the same phone and purpose.
        $this->postTo('otp/send', ['phone' => self::PHONE, 'purpose' => 'verify_phone'])->assertStatus(429)
            ->assertJsonPath('error.code', 'OTP_TOO_SOON')->assertJsonPath('error.details.retry_after', 60);
    }

    public function test_codes_need_sms(): void
    {
        $this->store('Plain Shop', 'plain.example.test', sms: false);

        $this->postTo('otp/send', ['phone' => self::PHONE, 'purpose' => 'login'], 'plain.example.test')
            ->assertStatus(422)->assertJsonPath('error.code', 'SMS_UNAVAILABLE');
    }

    public function test_sign_in_attempts_are_limited_per_phone_and_ip(): void
    {
        config(['pos.auth_rate_limit' => 3]);
        for ($i = 0; $i < 3; $i++) {
            $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => '000000'])->assertStatus(422);
        }
        $this->postTo('otp/login', ['phone' => '+8801712345678', 'code' => '000000'])->assertStatus(429)->assertJsonPath('error.code', 'TOO_MANY_REQUESTS');
        $this->postTo('otp/send', ['phone' => self::PHONE, 'purpose' => 'login'])->assertStatus(429)->assertJsonPath('error.code', 'TOO_MANY_REQUESTS');
        // Another number from the same address still has attempts left; so has an e-mail sign-in.
        $this->postTo('otp/login', ['phone' => '01812345678', 'code' => '000000'])->assertStatus(422);
        $this->postTo('login', ['email' => 'rina@example.test', 'password' => 'wrong-pass1'])->assertStatus(422);
    }

    public function test_a_verified_phone_of_one_store_never_signs_into_another(): void
    {
        $this->phoneSignUp();
        $this->clearBrowser();
        $this->store('Other Shop', 'other.example.test');

        // A's code does not work on B.
        $this->travel(61)->seconds();
        $codeA = $this->sendCode();
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $codeA], 'other.example.test')->assertStatus(422)->assertJsonPath('error.code', 'OTP_INVALID');

        // B's own code: no verified account on B — a new account is needed.
        $codeB = $this->sendCode(self::PHONE, 'login', 'other.example.test');
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $codeB], 'other.example.test')->assertOk()->assertJsonPath('data.status', 'needs_profile');
        $this->postTo('otp/register', ['name' => 'Rina on B'], 'other.example.test')->assertCreated()->assertJsonPath('data.phone_verified', true);

        $this->assertSame(2, CustomerAccount::query()->withoutGlobalScopes()->whereNotNull('phone_verified_at')->where('phone', self::PHONE)->count());
        $this->assertSame(2, CustomerAccount::query()->withoutGlobalScopes()->distinct()->count('organization_id'));
    }

    public function test_verifying_the_profile_phone_and_conflicts(): void
    {
        $this->registerShopper(self::HOST, 'rina@example.test', extra: ['phone' => self::PHONE]);
        $this->browse('GET', $this->url('profile'))->assertJsonPath('data.phone_verified', false)->assertJsonPath('data.has_password', true);

        $code = $this->sendCode(self::PHONE, 'verify_phone');
        $this->postTo('profile/phone', ['phone' => self::PHONE, 'code' => $this->wrongCode($code)])->assertStatus(422)->assertJsonPath('error.code', 'OTP_INVALID');
        $this->postTo('profile/phone', ['phone' => self::PHONE, 'code' => $code])->assertOk()
            ->assertJsonPath('data.phone', self::PHONE)->assertJsonPath('data.phone_verified', true);

        // Changing the number drops the verification; the same number keeps it.
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => self::PHONE])->assertOk()->assertJsonPath('data.phone_verified', true);
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => '01912345678'])->assertOk()->assertJsonPath('data.phone_verified', false);
        $this->travel(61)->seconds();
        $code = $this->sendCode(self::PHONE, 'verify_phone');
        $this->postTo('profile/phone', ['phone' => self::PHONE, 'code' => $code])->assertOk()->assertJsonPath('data.phone_verified', true);

        // Another account cannot verify the same number.
        $this->clearBrowser();
        $this->registerShopper(self::HOST, 'sister@example.test');
        $this->travel(61)->seconds();
        $code = $this->sendCode(self::PHONE, 'verify_phone');
        $this->postTo('profile/phone', ['phone' => self::PHONE, 'code' => $code])->assertStatus(409)->assertJsonPath('error.code', 'PHONE_IN_USE');
        $this->browse('GET', $this->url('profile'))->assertJsonPath('data.phone', null)->assertJsonPath('data.phone_verified', false);
        $this->assertSame(1, DB::table('customer_accounts')->whereNotNull('phone_verified_at')->count());
    }

    public function test_adding_an_e_mail_address_once(): void
    {
        $this->registerShopper(self::HOST, 'taken@example.test');
        $this->clearBrowser();
        $this->phoneSignUp();

        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => self::PHONE, 'email' => 'TAKEN@example.test'])
            ->assertStatus(422)->assertJsonValidationErrors(['email'], 'error.details');
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => self::PHONE, 'email' => 'Rina@Example.test'])->assertOk()
            ->assertJsonPath('data.email', 'rina@example.test')->assertJsonPath('data.email_verified', false)->assertJsonPath('data.phone_verified', true);
        $account = CustomerAccount::query()->withoutGlobalScopes()->where('phone', self::PHONE)->sole();
        Notification::assertSentTo($account, VerifyCustomerEmail::class);
        $this->assertSame('rina@example.test', Customer::query()->withoutGlobalScopes()->findOrFail($account->customer_id)->email);

        // Read-only from now on.
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => self::PHONE, 'email' => 'other@example.test'])->assertOk()
            ->assertJsonPath('data.email', 'rina@example.test');
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => self::PHONE, 'email' => 'rina@example.test'])->assertOk();
    }

    public function test_the_first_password_and_password_sign_in_of_a_phone_only_account(): void
    {
        $this->phoneSignUp(self::PHONE, 'rina@example.test');
        $this->postTo('logout')->assertNoContent();

        // No password yet: fails like a wrong password.
        $this->postTo('login', ['email' => 'rina@example.test', 'password' => 'anything-1'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');

        $this->travel(61)->seconds();
        $code = $this->sendCode();
        $this->postTo('otp/login', ['phone' => self::PHONE, 'code' => $code])->assertJsonPath('data.status', 'signed_in');
        $this->browse('PUT', $this->url('password'), ['password' => 'brand-new-pass2', 'password_confirmation' => 'brand-new-pass2'])->assertOk();
        $this->browse('GET', $this->url('profile'))->assertJsonPath('data.has_password', true);

        // From now on the current password is required.
        $this->browse('PUT', $this->url('password'), ['password' => 'another-pass3', 'password_confirmation' => 'another-pass3'])
            ->assertStatus(422)->assertJsonValidationErrors(['current_password'], 'error.details');

        $this->postTo('logout')->assertNoContent();
        $this->postTo('login', ['email' => 'rina@example.test', 'password' => 'brand-new-pass2'])->assertOk();
    }

    public function test_password_reset_ignores_phone_only_accounts(): void
    {
        $this->phoneSignUp();
        $this->postTo('logout')->assertNoContent();
        Notification::fake();

        $this->postTo('forgot-password', ['email' => 'rina@example.test'])->assertOk();
        Notification::assertNothingSent();
    }
}
