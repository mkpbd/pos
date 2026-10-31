<?php

namespace App\Modules\CustomerAccounts\Tests\Feature;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Infrastructure\Notifications\ResetCustomerPassword;
use App\Modules\CustomerAccounts\Infrastructure\Notifications\VerifyCustomerEmail;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class CustomerAccountTest extends TestCase
{
    use ActsAsShopper, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const HOST = 'shop.example.test';

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.auth_rate_limit' => 100]);
    }

    private function store(string $name = 'Berry Kids', string $host = self::HOST): array
    {
        $tenant = $this->openStore($name, $host);
        $this->asVisitor();

        return $tenant;
    }

    private function url(string $path, string $host = self::HOST): string
    {
        return "http://{$host}/api/v1/store/account/{$path}";
    }

    public function test_registration_creates_a_new_customer_signs_in_and_sends_a_verification_link(): void
    {
        ['organization' => $org] = $this->store();

        $this->browse('GET', $this->url('me'))->assertOk()->assertJsonPath('data', null);

        $data = $this->registerShopper(self::HOST, 'Rina@Example.TEST', extra: ['phone' => '+88 017-1234-5678']);
        $this->assertSame('rina@example.test', $data['customer']['email']);
        $this->assertSame('01712345678', $data['customer']['phone']);
        $this->assertSame('Rina Akter', $data['customer']['name']);
        $this->assertFalse($data['customer']['email_verified']);
        $this->assertSame(['merged_lines' => 0, 'capped_lines' => 0], $data['merge']);

        $account = CustomerAccount::query()->withoutGlobalScopes()->sole();
        $customer = Customer::query()->withoutGlobalScopes()->findOrFail($account->customer_id);
        $this->assertSame($org->id, $account->organization_id);
        $this->assertStringStartsWith('CUS-', $customer->code);
        $this->assertSame(['Rina Akter', 'rina@example.test', '01712345678'], [$customer->name, $customer->email, $customer->phone]);

        $this->browse('GET', $this->url('me'))->assertOk()->assertJsonPath('data.email', 'rina@example.test');
        $this->browse('GET', $this->url('profile'))->assertOk()->assertJsonPath('data.id', $account->id);

        Notification::assertSentTo($account, VerifyCustomerEmail::class, function (VerifyCustomerEmail $n) {
            return str_starts_with($n->verifyUrl, 'http://shop.example.test/account/verify-email?token=') && $n->storeName === 'Berry Kids';
        });
    }

    public function test_registration_never_links_an_existing_pos_customer(): void
    {
        ['organization' => $org] = $this->store();
        $pos = $this->inTenant($org, fn () => Customer::query()->create(['code' => 'C-1', 'name' => 'Walk-in Rina', 'phone' => '01712345678', 'email' => 'rina@example.test']));

        $this->registerShopper(self::HOST, 'rina@example.test', extra: ['phone' => '01712345678']);

        $account = CustomerAccount::query()->withoutGlobalScopes()->sole();
        $this->assertNotSame($pos->id, $account->customer_id);
        $this->assertSame('01712345678', $account->phone);
        // The till's lookup key stays with the existing customer.
        $this->assertNull(Customer::query()->withoutGlobalScopes()->findOrFail($account->customer_id)->phone);
        $this->assertSame('Walk-in Rina', $pos->fresh()->name);
    }

    public function test_registration_validates_and_e_mail_is_unique_per_store(): void
    {
        $this->store();
        $this->store('Tiny Toes', 'tiny.example.test');
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->clearBrowser();

        $this->browse('POST', $this->url('register'), [
            'name' => 'Other', 'email' => 'RINA@example.test', 'password' => 'secret-pass1', 'password_confirmation' => 'secret-pass1',
        ])->assertStatus(422)->assertJsonPath('error.details.email.0', 'The email has already been taken.');

        $this->browse('POST', $this->url('register'), [
            'name' => 'Bad', 'email' => 'bad@example.test', 'phone' => '12345', 'password' => 'short', 'password_confirmation' => 'other',
        ])->assertStatus(422)->assertJsonValidationErrors(['phone', 'password'], 'error.details');

        // Another store has its own accounts.
        $this->registerShopper('tiny.example.test', 'rina@example.test');
        $this->assertSame(2, CustomerAccount::query()->withoutGlobalScopes()->count());
    }

    public function test_login_failures_are_indistinguishable_and_disabled_accounts_cannot_sign_in(): void
    {
        $this->store();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->browse('POST', $this->url('logout'))->assertNoContent();
        $this->browse('GET', $this->url('me'))->assertJsonPath('data', null);

        $wrong = $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'wrong-pass1']);
        $unknown = $this->browse('POST', $this->url('login'), ['email' => 'nobody@example.test', 'password' => 'wrong-pass1']);
        $wrong->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $unknown->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $this->assertSame($wrong->json('error.message'), $unknown->json('error.message'));

        CustomerAccount::query()->withoutGlobalScopes()->update(['status' => 'disabled']);
        $disabled = $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'secret-pass1']);
        $disabled->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');
        $this->assertSame($wrong->json('error.message'), $disabled->json('error.message'));

        CustomerAccount::query()->withoutGlobalScopes()->update(['status' => 'active']);
        $this->browse('POST', $this->url('login'), ['email' => 'RINA@example.test', 'password' => 'secret-pass1', 'remember' => true])
            ->assertOk()->assertJsonPath('data.customer.email', 'rina@example.test')->assertJsonPath('data.merge.merged_lines', 0);
        $this->assertNotNull(CustomerAccount::query()->withoutGlobalScopes()->sole()->last_login_at);
    }

    public function test_sign_in_is_rate_limited_per_e_mail_and_ip(): void
    {
        $this->store();
        config(['pos.auth_rate_limit' => 3]);

        for ($i = 0; $i < 3; $i++) {
            $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'wrong-pass1'])->assertStatus(422);
        }
        $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'wrong-pass1'])
            ->assertStatus(429)->assertJsonPath('error.code', 'TOO_MANY_REQUESTS');
        $this->browse('POST', $this->url('forgot-password'), ['email' => 'rina@example.test'])->assertStatus(429);
        // Another address from the same IP still has attempts left.
        $this->browse('POST', $this->url('login'), ['email' => 'other@example.test', 'password' => 'wrong-pass1'])->assertStatus(422);
    }

    public function test_password_reset_never_reveals_accounts_and_signs_in(): void
    {
        $this->store();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->clearBrowser();
        $account = CustomerAccount::query()->withoutGlobalScopes()->sole();

        $known = $this->browse('POST', $this->url('forgot-password'), ['email' => 'RINA@example.test'])->assertOk();
        $unknown = $this->browse('POST', $this->url('forgot-password'), ['email' => 'ghost@example.test'])->assertOk();
        $this->assertSame($known->json('data'), $unknown->json('data'));

        $token = null;
        Notification::assertSentTo($account, ResetCustomerPassword::class, function (ResetCustomerPassword $n) use (&$token) {
            parse_str((string) parse_url($n->resetUrl, PHP_URL_QUERY), $query);
            $token = $query['token'];

            return str_starts_with($n->resetUrl, 'http://shop.example.test/account/reset-password?') && $query['email'] === 'rina@example.test';
        });
        Notification::assertSentTimes(ResetCustomerPassword::class, 1);
        $this->assertDatabaseMissing('customer_password_reset_tokens', ['token_hash' => $token]);

        $reset = fn (string $email, string $t) => $this->browse('POST', $this->url('reset-password'), [
            'email' => $email, 'token' => $t, 'password' => 'brand-new-pass2', 'password_confirmation' => 'brand-new-pass2',
        ]);
        $reset('ghost@example.test', $token)->assertStatus(422)->assertJsonValidationErrors(['token'], 'error.details');
        $reset('rina@example.test', 'not-the-token')->assertStatus(422)->assertJsonValidationErrors(['token'], 'error.details');

        $reset('rina@example.test', $token)->assertOk()->assertJsonPath('data.customer.email', 'rina@example.test')
            ->assertJsonPath('data.customer.email_verified', true);
        $this->browse('GET', $this->url('me'))->assertJsonPath('data.email', 'rina@example.test');
        // One use only.
        $reset('rina@example.test', $token)->assertStatus(422)->assertJsonValidationErrors(['token'], 'error.details');

        $this->browse('POST', $this->url('logout'))->assertNoContent();
        $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'brand-new-pass2'])->assertOk();
    }

    public function test_password_reset_links_expire_after_an_hour(): void
    {
        $this->store();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->clearBrowser();

        $this->browse('POST', $this->url('forgot-password'), ['email' => 'rina@example.test'])->assertOk();
        $token = null;
        Notification::assertSentTo(CustomerAccount::query()->withoutGlobalScopes()->sole(), ResetCustomerPassword::class, function (ResetCustomerPassword $n) use (&$token) {
            parse_str((string) parse_url($n->resetUrl, PHP_URL_QUERY), $query);
            $token = $query['token'];

            return true;
        });

        $this->travel(61)->minutes();
        $this->browse('POST', $this->url('reset-password'), [
            'email' => 'rina@example.test', 'token' => $token, 'password' => 'brand-new-pass2', 'password_confirmation' => 'brand-new-pass2',
        ])->assertStatus(422)->assertJsonValidationErrors(['token'], 'error.details');
    }

    public function test_e_mail_verification_link_and_resend(): void
    {
        $this->store();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $account = CustomerAccount::query()->withoutGlobalScopes()->sole();
        $tokenOf = function () use ($account): string {
            $token = null;
            Notification::assertSentTo($account, VerifyCustomerEmail::class, function (VerifyCustomerEmail $n) use (&$token) {
                parse_str((string) parse_url($n->verifyUrl, PHP_URL_QUERY), $query);
                $token = $query['token'];

                return true;
            });

            return $token;
        };
        $first = $tokenOf();

        // A new link replaces the old one.
        $this->browse('POST', $this->url('verification-notification'))->assertOk();
        Notification::assertSentTimes(VerifyCustomerEmail::class, 2);
        $this->browse('POST', $this->url('verify-email'), ['token' => $first])->assertStatus(422)->assertJsonPath('error.code', 'TOKEN_INVALID');

        $second = null;
        Notification::assertSentTo($account, VerifyCustomerEmail::class, function (VerifyCustomerEmail $n) use (&$second, $first) {
            parse_str((string) parse_url($n->verifyUrl, PHP_URL_QUERY), $query);
            if ($query['token'] !== $first) {
                $second = $query['token'];
            }

            return true;
        });

        $this->travel(25)->hours();
        $this->browse('POST', $this->url('verify-email'), ['token' => $second])->assertStatus(422)->assertJsonPath('error.code', 'TOKEN_INVALID');
        $this->travelBack();

        $this->browse('POST', $this->url('verification-notification'))->assertOk();
        $third = null;
        Notification::assertSentTo($account, VerifyCustomerEmail::class, function (VerifyCustomerEmail $n) use (&$third, $first, $second) {
            parse_str((string) parse_url($n->verifyUrl, PHP_URL_QUERY), $query);
            if (! in_array($query['token'], [$first, $second], true)) {
                $third = $query['token'];
            }

            return true;
        });
        // Works without being signed in (the link may be opened on another device).
        $this->clearBrowser();
        $this->browse('POST', $this->url('verify-email'), ['token' => $third])->assertOk();
        $this->assertNotNull($account->fresh()->email_verified_at);
        $this->browse('POST', $this->url('verify-email'), ['token' => $third])->assertStatus(422);
    }

    public function test_profile_and_password_change(): void
    {
        $this->store();
        $this->registerShopper(self::HOST, 'rina@example.test');

        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina Begum', 'phone' => '019 1234 5678'])->assertOk()
            ->assertJsonPath('data.name', 'Rina Begum')->assertJsonPath('data.phone', '01912345678');
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => '01212345678'])->assertStatus(422)
            ->assertJsonValidationErrors(['phone'], 'error.details');
        $this->browse('PUT', $this->url('profile'), ['name' => 'Rina', 'phone' => null])->assertOk()->assertJsonPath('data.phone', null);

        $this->browse('PUT', $this->url('password'), ['current_password' => 'wrong-pass1', 'password' => 'brand-new-pass2', 'password_confirmation' => 'brand-new-pass2'])
            ->assertStatus(422)->assertJsonValidationErrors(['current_password'], 'error.details');
        $this->browse('PUT', $this->url('password'), ['current_password' => 'secret-pass1', 'password' => 'brand-new-pass2', 'password_confirmation' => 'brand-new-pass2'])
            ->assertOk();

        $this->browse('POST', $this->url('logout'))->assertNoContent();
        $this->browse('GET', $this->url('profile'))->assertUnauthorized();
        $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'secret-pass1'])->assertStatus(422);
        $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'brand-new-pass2'])->assertOk();
    }

    public function test_staff_see_and_switch_the_online_account(): void
    {
        $tenant = $this->store();
        $data = $this->registerShopper(self::HOST, 'rina@example.test');
        $customerId = CustomerAccount::query()->withoutGlobalScopes()->sole()->customer_id;
        $this->assertSame($data['customer']['id'], CustomerAccount::query()->withoutGlobalScopes()->sole()->id);
        $walkIn = $this->inTenant($tenant['organization'], fn () => Customer::query()->create(['code' => 'C-9', 'name' => 'Walk-in']));

        $this->actingAsUser($tenant['admin']);
        $this->getJson("/api/v1/customers/{$customerId}")->assertOk()
            ->assertJsonPath('data.online_account.email', 'rina@example.test')
            ->assertJsonPath('data.online_account.status', 'active')
            ->assertJsonPath('data.online_account.email_verified_at', null);
        $this->assertNotNull($this->getJson("/api/v1/customers/{$customerId}")->json('data.online_account.last_login_at'));
        $this->getJson("/api/v1/customers/{$walkIn->id}")->assertOk()->assertJsonPath('data.online_account', null);
        $this->assertArrayNotHasKey('online_account', $this->getJson('/api/v1/customers')->json('data.0'));

        $this->patchJson("/api/v1/customer-accounts/{$customerId}", ['status' => 'disabled'])->assertOk()
            ->assertExactJsonStructure(['success', 'data' => ['email', 'email_verified_at', 'last_login_at', 'status', 'created_at'], 'meta'])
            ->assertJsonPath('data.status', 'disabled');
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer_account.status_changed']);
        $this->patchJson("/api/v1/customer-accounts/{$walkIn->id}", ['status' => 'disabled'])->assertNotFound();
        $this->patchJson("/api/v1/customer-accounts/{$customerId}", ['status' => 'gone'])->assertStatus(422);

        // The shopper's open session is rejected from the next request on.
        $this->browse('GET', $this->url('profile'))->assertUnauthorized();
        $this->browse('GET', $this->url('me'))->assertOk()->assertJsonPath('data', null);
        $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'secret-pass1'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INVALID_CREDENTIALS');

        $this->actingAsUser($tenant['admin']);
        $this->patchJson("/api/v1/customer-accounts/{$customerId}", ['status' => 'active'])->assertOk()->assertJsonPath('data.status', 'active');
        $this->browse('POST', $this->url('login'), ['email' => 'rina@example.test', 'password' => 'secret-pass1'])->assertOk();
    }

    public function test_switching_online_sign_in_needs_customers_manage(): void
    {
        $tenant = $this->store();
        $this->registerShopper(self::HOST, 'rina@example.test');
        $customerId = CustomerAccount::query()->withoutGlobalScopes()->sole()->customer_id;
        $cashier = $this->createUserWithRole($tenant['organization'], SystemRole::Cashier);

        $this->actingAsUser($cashier);
        $this->patchJson("/api/v1/customer-accounts/{$customerId}", ['status' => 'disabled'])->assertForbidden();

        // Another organization's staff cannot reach the account.
        $other = $this->provisionTenant('Other Org');
        $this->actingAsUser($other['admin']);
        $this->patchJson("/api/v1/customer-accounts/{$customerId}", ['status' => 'disabled'])->assertNotFound();
    }
}
