<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Fakes\FakePhoneVerification;
use App\Modules\Orders\Tests\Fakes\FakeSmsSender;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use App\Modules\Sms\Application\Contracts\SmsSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1a §4: the checkout's contact fields — the customer e-mail (required / optional / hidden),
 * the mobile number checked with an SMS code (off / cod / all; session or verified account
 * number), the landing page order form, per-customer promotion limits by phone and the store
 * settings / bootstrap that carry them. SMS is faked through its contracts.
 */
class CheckoutContactTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private FakeSmsSender $sms;

    private FakePhoneVerification $codes;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->sms = new FakeSmsSender;
        $this->codes = new FakePhoneVerification;
        $this->app->instance(SmsSender::class, $this->sms);
        $this->app->instance(PhoneVerification::class, $this->codes);
        $this->buildShop();
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function storeSettings(array $settings): TestResponse
    {
        $this->actingAsUser($this->tenant['admin']);
        $response = $this->patchJson('/api/v1/storefront/settings', $settings);
        $this->asVisitor();

        return $response;
    }

    private function sendCode(string $phone, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('checkout/phone/send', $host), ['phone' => $phone]);
    }

    private function verifyCode(string $phone, string $code = FakePhoneVerification::CODE, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('checkout/phone/verify', $host), ['phone' => $phone, 'code' => $code]);
    }

    private function onlineMovements(): int
    {
        return StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order')->count();
    }

    public function test_store_settings_bootstrap_and_options_carry_the_contact_fields(): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $this->getJson('/api/v1/storefront/settings')->assertOk()
            ->assertJsonPath('data.checkout_email', 'optional')
            ->assertJsonPath('data.checkout_phone_verification', 'off')
            ->assertJsonPath('data.sms_ready', true)
            ->assertJsonPath('data.otp_ready', true);

        // The phone check needs SMS codes to work.
        $this->sms->otpReady = false;
        $this->patchJson('/api/v1/storefront/settings', ['checkout_phone_verification' => 'cod'])->assertStatus(422)->assertJsonPath('error.code', 'SMS_NOT_READY');
        $this->getJson('/api/v1/storefront/settings')->assertJsonPath('data.sms_ready', true)->assertJsonPath('data.otp_ready', false);
        // E-mail mode alone is fine.
        $this->patchJson('/api/v1/storefront/settings', ['checkout_email' => 'hidden', 'checkout_phone_verification' => 'off'])->assertOk()
            ->assertJsonPath('data.checkout_email', 'hidden');
        $this->patchJson('/api/v1/storefront/settings', ['checkout_email' => 'sometimes', 'checkout_phone_verification' => 'always'])->assertStatus(422)
            ->assertJsonValidationErrors(['checkout_email', 'checkout_phone_verification'], 'error.details');

        $this->sms->otpReady = true;
        $this->patchJson('/api/v1/storefront/settings', ['checkout_phone_verification' => 'cod'])->assertOk()
            ->assertJsonPath('data.checkout_phone_verification', 'cod')
            ->assertJsonPath('data.otp_ready', true);
        $audit = DB::table('audit_logs')->where('action', 'storefront.settings_updated')->pluck('new_values')->implode(' ');
        $this->assertStringContainsString('checkout_email', $audit);
        $this->assertStringContainsString('checkout_phone_verification', $audit);

        // An unchanged phone check does not block other changes while SMS is down.
        $this->sms->otpReady = false;
        $this->patchJson('/api/v1/storefront/settings', ['checkout_phone_verification' => 'cod', 'meta_description' => 'Kids wear'])->assertOk();
        $this->sms->otpReady = true;
        $this->asVisitor();

        $this->browse('GET', $this->storeUrl('bootstrap'))->assertOk()
            ->assertJsonPath('data.checkout', ['email' => 'hidden', 'phone_verification' => 'cod'])
            ->assertJsonPath('data.account', ['phone_login' => true]);
        $options = $this->browse('GET', $this->storeUrl('checkout/options'))->assertOk()->json('data');
        $this->assertSame(['hidden', 'cod', true], [$options['email_field'], $options['phone_verification'], $options['phone_login']]);

        // SMS stops working: the check is off for shoppers (orders are not blocked), no phone sign-in.
        $this->sms->otpReady = false;
        $this->browse('GET', $this->storeUrl('bootstrap'))->assertOk()
            ->assertJsonPath('data.checkout', ['email' => 'hidden', 'phone_verification' => 'off'])
            ->assertJsonPath('data.account', ['phone_login' => false]);
        $this->browse('GET', $this->storeUrl('checkout/options'))->assertJsonPath('data.phone_verification', 'off')->assertJsonPath('data.phone_login', false);
    }

    public function test_the_e_mail_field_follows_the_store_setting(): void
    {
        // Optional (default): no e-mail, null or an e-mail.
        $this->addToCart('SHIRT', 1);
        $body = $this->checkoutBody('510.00', ['contact' => ['name' => 'Rina Akter', 'phone' => '01712345678']]);
        $order = $this->placeOrder($body)->assertCreated()->json('data.order');
        $this->assertNull($order['contact']['email']);
        $this->assertNull(Order::query()->withoutGlobalScopes()->value('contact_email'));
        $this->assertNull(DB::table('order_addresses')->value('email'));

        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('510.00', ['contact' => ['name' => 'Rina', 'email' => 'not-an-email', 'phone' => '01712345678']]))
            ->assertStatus(422)->assertJsonValidationErrors(['contact.email'], 'error.details');
        $this->placeOrder($this->checkoutBody('510.00', ['contact' => ['name' => 'Rina', 'email' => null, 'phone' => '01712345678']]))->assertCreated();

        // Required.
        $this->storeSettings(['checkout_email' => 'required'])->assertOk();
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($body)->assertStatus(422)->assertJsonValidationErrors(['contact.email'], 'error.details');
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated()->assertJsonPath('data.order.contact.email', 'rina@example.test');

        // Hidden: whatever is sent is ignored.
        $this->storeSettings(['checkout_email' => 'hidden'])->assertOk();
        $this->addToCart('SHIRT', 1);
        $hidden = $this->placeOrder($this->checkoutBody('510.00', ['contact' => ['name' => 'Rina', 'email' => 'not-an-email', 'phone' => '01712345678']]))
            ->assertCreated()->json('data.order');
        $this->assertNull($hidden['contact']['email']);
        $this->assertNull(Order::query()->withoutGlobalScopes()->where('number', $hidden['number'])->value('contact_email'));
    }

    public function test_the_phone_check_by_payment_method_and_session(): void
    {
        $this->storeSettings(['checkout_phone_verification' => 'cod'])->assertOk();
        $this->addToCart('SHIRT', 1);

        // Cash on delivery needs the code; nothing is taken from stock.
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)
            ->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED')->assertJsonPath('error.details.phone', '01712345678');
        $this->assertSame([0, 0], [Order::query()->withoutGlobalScopes()->count(), $this->onlineMovements()]);
        // Bank transfer does not in `cod` mode.
        $this->placeOrder($this->checkoutBody('510.00', ['payment_method' => 'bank_transfer']))->assertCreated();

        // `all`: every order.
        $this->storeSettings(['checkout_phone_verification' => 'all'])->assertOk();
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('510.00', ['payment_method' => 'bank_transfer']))->assertStatus(422)->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED');

        // Send and check a code (any usual format of the number).
        $this->sendCode('+880 1712-345678')->assertStatus(202)->assertJsonPath('data', ['resend_after' => 60, 'expires_in' => 300]);
        $this->assertSame(['01712345678', 'checkout', $this->tenant['organization']->id], [$this->codes->sent[0]['phone'], $this->codes->sent[0]['purpose'], $this->codes->sent[0]['org']]);
        $this->sendCode('12345')->assertStatus(422)->assertJsonValidationErrors(['phone'], 'error.details');
        $this->verifyCode('01712345678', '000000')->assertStatus(422)->assertJsonPath('error.code', 'OTP_INVALID');
        $this->verifyCode('01712345678')->assertOk()->assertJsonPath('data', ['phone' => '01712345678', 'verified' => true]);

        // Another number is not checked.
        $this->placeOrder($this->checkoutBody('510.00', ['contact' => ['name' => 'Rina', 'email' => 'rina@example.test', 'phone' => '01812345678']]))
            ->assertStatus(422)->assertJsonPath('error.details.phone', '01812345678');
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();

        // The check lasts two hours (the session itself stays alive).
        $this->travel(61)->minutes();
        $this->addToCart('SHIRT', 1);
        $this->travel(60)->minutes();
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED');

        // SMS stops working: checkout goes on without the check.
        $this->sms->otpReady = false;
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();
    }

    public function test_a_signed_in_shoppers_verified_number_needs_no_code(): void
    {
        $this->storeSettings(['checkout_phone_verification' => 'all'])->assertOk();
        $customer = $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 1);

        // An account number that is not verified does not count.
        DB::table('customer_accounts')->where('id', $customer['customer']['id'])->update(['phone' => '01712345678', 'phone_verified_at' => null]);
        $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED');

        DB::table('customer_accounts')->where('id', $customer['customer']['id'])->update(['phone_verified_at' => now()]);
        $this->placeOrder($this->checkoutBody('510.00', ['contact' => ['name' => 'Rina', 'email' => 'rina@example.test', 'phone' => '01812345678']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED');
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();
        $this->assertSame([], $this->codes->sent);
    }

    public function test_the_landing_page_order_form_checks_the_phone_too(): void
    {
        $shirt = (string) DB::table('product_variants')->where('id', $this->v['SHIRT'])->value('product_id');
        $document = $this->landing($shirt);
        $this->storeSettings(['checkout_phone_verification' => 'cod'])->assertOk();
        $body = [
            'document_id' => $document,
            'element_id' => 'e_order',
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 1]],
            'contact' => ['name' => 'Rina Akter', 'phone' => '01712345678'],
            'address' => ['district_id' => self::DHAKA, 'address_line' => 'House 1, Road 2'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'expected_total' => '510.00',
        ];
        $direct = fn () => $this->browse('POST', $this->storeUrl('checkout/direct'), $body, ['Idempotency-Key' => (string) Str::uuid()]);

        $direct()->assertStatus(422)->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED');
        $this->assertSame(0, $this->onlineMovements());

        $this->sendCode('01712345678')->assertStatus(202);
        $this->verifyCode('01712345678')->assertOk();
        $direct()->assertCreated()->assertJsonPath('data.order.contact.phone', '01712345678');
    }

    public function test_a_number_checked_on_one_store_does_not_count_on_another(): void
    {
        $this->storeSettings(['checkout_phone_verification' => 'all'])->assertOk();
        $this->sendCode('01712345678')->assertStatus(202);
        $this->verifyCode('01712345678')->assertOk();
        $a = $this->tenant['organization'];

        // Store B, same browser (the session cookie travels along): not checked there.
        $this->buildShop('Tiny Shop', 'tiny.test');
        $this->storeSettings(['checkout_phone_verification' => 'all'])->assertOk();
        $this->addToCart('SHIRT', 1, 'tiny.test');
        $this->placeOrder($this->checkoutBody('510.00'), null, 'tiny.test')->assertStatus(422)->assertJsonPath('error.code', 'PHONE_NOT_VERIFIED');

        // A's code does not check the number on B either.
        $this->verifyCode('01712345678', FakePhoneVerification::CODE, 'tiny.test')->assertStatus(422)->assertJsonPath('error.code', 'OTP_INVALID');
        $this->sendCode('01712345678', 'tiny.test')->assertStatus(202);
        $this->assertNotSame($a->id, $this->codes->sent[1]['org']);
        $this->verifyCode('01712345678', FakePhoneVerification::CODE, 'tiny.test')->assertOk();
        $this->placeOrder($this->checkoutBody('510.00'), null, 'tiny.test')->assertCreated();
    }

    public function test_per_customer_promotion_limits_count_the_mobile_number(): void
    {
        $this->makePromotion($this->tenant['organization'], ['name' => 'Once', 'type' => 'fixed', 'value' => '50', 'usage_limit_per_customer' => 1]);
        $contact = fn (string $email, string $phone) => ['contact' => ['name' => 'Rina', 'email' => $email, 'phone' => $phone]];

        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('460.00', $contact('a@example.test', '01712345678')))->assertCreated();
        $this->assertSame('01712345678', PromotionRedemption::query()->withoutGlobalScopes()->value('phone'));

        // Another guest e-mail (or none) with the same number: the offer is used up.
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod', 'contact' => ['phone' => '+8801712345678']])
            ->assertOk()->assertJsonPath('data.total', '510.00');
        $this->placeOrder($this->checkoutBody('460.00', ['contact' => ['name' => 'Rina', 'phone' => '01712345678']]))
            ->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED')->assertJsonPath('error.details.total', '510.00');

        // Another number and e-mail: still available.
        $this->placeOrder($this->checkoutBody('460.00', $contact('b@example.test', '01812345678')))->assertCreated();
        $this->assertSame(2, PromotionRedemption::query()->withoutGlobalScopes()->count());
    }

    /**
     * A published landing page with a cash-on-delivery order form for the product.
     */
    private function landing(string $productId): string
    {
        $this->actingAsUser($this->tenant['admin']);
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:shirt-offer', 'title' => 'Offer'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [[
                'id' => 'e_order', 'type' => 'order_form', 'props' => [
                    'product_id' => $productId,
                    'title' => 'Order now',
                    'quantity' => ['default' => 1, 'max' => 3],
                    'fields' => ['email' => 'optional', 'note' => 'optional'],
                    'payment' => 'cod_only',
                    'button_label' => 'Confirm order',
                    'success_message' => 'Thank you!',
                ],
            ]]]],
        ]]]])->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        $this->asVisitor();

        return $id;
    }
}
