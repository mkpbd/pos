<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Sales\Infrastructure\Mail\SaleReceiptMail;
use App\Modules\Sales\Infrastructure\Models\SaleReceiptDelivery;
use App\Modules\Sales\Infrastructure\Models\SaleReceiptLink;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * POS1d §2: digital receipts — the public link (made once, reused), the public receipt page API
 * (no secrets; per store host; cancelled; unknown; throttled), sending by SMS (the `sale_receipt`
 * template) or e-mail (SaleReceiptMail), five sends per sale, the deliveries on the sale
 * document, permissions, isolation and masked recipients in the audit trail.
 */
class DigitalReceiptTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private const HOST = 'alpha-shop.test';

    private Organization $org;

    private User $admin;

    private string $store;

    private ProductVariant $juice;

    private Customer $rahim;

    private string $branchId;

    protected function setUp(): void
    {
        parent::setUp();
        config(['logging.channels.sms' => config('logging.channels.null')]);

        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant('Alpha');
        $this->branchId = $branch->id;
        $this->juice = $this->sellable($this->org, 'Mango Juice', '15.00', ['cost' => '9.25']);
        $this->store = $this->mainStoreId($this->org);
        $this->rahim = $this->customer($this->org, 'Rahim Uddin');
        $this->inTenant($this->org, fn () => $this->rahim->forceFill(['phone' => '01712345678', 'email' => 'rahim@example.test'])->save());
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $this->juice, '50');
    }

    private function sell(?string $customerId = null): string
    {
        return $this->checkout($this->cart($this->store, [[$this->juice, '2']], [['cash', '100']], array_filter(['customer_id' => $customerId])))
            ->assertCreated()->json('data.id');
    }

    private function openShop(string $host = self::HOST): void
    {
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => 'Alpha Shop', 'is_enabled' => true])->assertOk();
    }

    private function enableSms(array $settings = []): void
    {
        $this->patchJson('/api/v1/sms/settings', $settings + ['is_enabled' => true, 'driver' => 'log'])->assertOk();
    }

    private function send(string $saleId, array $body): TestResponse
    {
        return $this->postJson("/api/v1/sales/{$saleId}/receipt/send", $body);
    }

    private function publicReceipt(string $token, string $host = self::HOST): TestResponse
    {
        $this->app['auth']->forgetGuards();

        return $this->getJson("http://{$host}/api/v1/store/receipts/{$token}");
    }

    private function siteUrl(string $host = self::HOST): string
    {
        return (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https').'://'.$host;
    }

    public function test_the_receipt_link_is_made_once_and_reused(): void
    {
        $sale = $this->sell($this->rahim->id);

        // No online store yet: a token, but no address.
        $first = $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertOk()->assertJsonPath('data.url', null)->json('data');
        $this->assertSame(40, strlen($first['token']));
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9]{40}$/', $first['token']);

        $this->openShop();
        $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertOk()
            ->assertJsonPath('data.token', $first['token'])
            ->assertJsonPath('data.url', $this->siteUrl().'/receipt/'.$first['token']);
        $this->assertSame(1, SaleReceiptLink::query()->withoutGlobalScopes()->count());

        // A closed store has no receipt page.
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false])->assertOk();
        $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertOk()->assertJsonPath('data.url', null);

        // Another sale gets another token.
        $other = $this->getJson('/api/v1/sales/'.$this->sell().'/receipt-link')->assertOk()->json('data.token');
        $this->assertNotSame($first['token'], $other);
    }

    public function test_the_public_receipt_shows_what_the_receipt_prints_and_no_secrets(): void
    {
        $this->openShop();
        $this->org->forceFill(['settings' => ['receipt_footer' => 'Thank you, come again'] + ($this->org->settings ?? [])])->save();
        $sale = $this->sell($this->rahim->id);
        $token = $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertOk()->json('data.token');

        $response = $this->publicReceipt($token)->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $data = $response->json('data');
        $this->assertSame('completed', $data['status']);
        $this->assertSame(['name' => 'Rahim Uddin'], $data['customer']);
        $this->assertSame(['name' => 'Owner'], $data['cashier']);
        $this->assertSame('Alpha', $data['receipt']['organization_name']);
        $this->assertSame('Thank you, come again', $data['receipt']['footer']);
        $this->assertSame(['name' => 'Mango Juice', 'quantity' => '2.000', 'total' => '30.00'], [
            'name' => $data['lines'][0]['product_name'], 'quantity' => $data['lines'][0]['quantity'], 'total' => $data['lines'][0]['line_total'],
        ]);
        $this->assertSame(['30.00', '30.00', '70.00', '100.00'], [$data['total'], $data['paid_total'], $data['change_total'], $data['payments'][0]['tendered']]);
        $this->assertSame('Cash', $data['payments'][0]['method_label']);
        $this->assertNull($data['exchange']);

        $json = $response->getContent();
        foreach (['01712345678', 'rahim@example.test', '9.25', 'unit_cost', 'cost_total', 'store_credit', 'receipt_deliveries', $sale, $this->admin->id, $this->org->id, $this->rahim->id, $this->juice->id] as $secret) {
            $this->assertStringNotContainsString($secret, (string) $json, "The public receipt leaks {$secret}");
        }

        // Cancelled: still readable, marked as such.
        $this->actingAsUser($this->admin);
        $this->postJson("/api/v1/sales/{$sale}/cancel", ['reason' => 'Wrong items'])->assertOk();
        $this->publicReceipt($token)->assertOk()->assertJsonPath('data.status', 'cancelled');

        // Unknown or malformed tokens.
        $this->publicReceipt(Str::random(40))->assertNotFound()->assertJsonPath('error.code', 'RECEIPT_NOT_FOUND');
        $this->publicReceipt('short')->assertNotFound()->assertJsonPath('error.code', 'RECEIPT_NOT_FOUND');
    }

    public function test_another_stores_host_cannot_read_the_receipt(): void
    {
        $this->openShop();
        $token = $this->getJson('/api/v1/sales/'.$this->sell().'/receipt-link')->assertOk()->json('data.token');

        ['admin' => $betaAdmin] = $this->provisionTenant('Beta');
        $this->actingAsUser($betaAdmin);
        $this->openShop('beta-shop.test');

        $this->publicReceipt($token, 'beta-shop.test')->assertNotFound()->assertJsonPath('error.code', 'RECEIPT_NOT_FOUND');
        $this->publicReceipt($token, 'unknown-shop.test')->assertNotFound()->assertJsonPath('error.code', 'STOREFRONT_NOT_FOUND');
        $this->publicReceipt($token)->assertOk();
    }

    public function test_the_public_receipt_is_throttled_per_ip(): void
    {
        $this->openShop();
        $token = $this->getJson('/api/v1/sales/'.$this->sell().'/receipt-link')->assertOk()->json('data.token');

        for ($i = 0; $i < 30; $i++) {
            $this->publicReceipt($token)->assertOk();
        }
        $this->publicReceipt($token)->assertStatus(429);
    }

    public function test_a_receipt_is_sent_by_sms_to_the_customer_or_another_number(): void
    {
        $this->openShop();
        $this->enableSms();
        $sale = $this->sell($this->rahim->id);
        $number = $this->getJson("/api/v1/sales/{$sale}")->json('data.number');

        $this->send($sale, ['channel' => 'sms'])->assertCreated()
            ->assertJsonPath('data', ['channel' => 'sms', 'recipient_masked' => '017••••678', 'status' => 'queued']);
        $token = SaleReceiptLink::query()->withoutGlobalScopes()->value('token');

        $message = SmsMessage::query()->withoutGlobalScopes()->sole();
        $this->assertSame(['01712345678', 'sale_receipt', 'sale', $sale], [$message->to_phone, $message->purpose, $message->related_type, $message->related_id]);
        $this->assertSame("Alpha Shop: Receipt {$number}, total Tk 30.00. Thank you for shopping with us! ".$this->siteUrl().'/receipt/'.$token, $message->body);

        // Another number, written any way.
        $this->send($sale, ['channel' => 'sms', 'to' => '+880 1812-345679'])->assertCreated()->assertJsonPath('data.recipient_masked', '018••••679');
        $this->assertTrue(SmsMessage::query()->withoutGlobalScopes()->where('to_phone', '01812345679')->exists());

        // The store's default language.
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => true, 'default_locale' => 'bn'])->assertOk();
        $this->send($sale, ['channel' => 'sms'])->assertCreated();
        $this->assertTrue(SmsMessage::query()->withoutGlobalScopes()->get()->contains(fn (SmsMessage $m) => str_contains($m->body, 'রসিদ '.$number)));

        // Invalid numbers and a sale without a customer.
        $this->send($sale, ['channel' => 'sms', 'to' => '12345'])->assertUnprocessable()->assertJsonValidationErrors(['to'], 'error.details');
        $this->send($this->sell(), ['channel' => 'sms'])->assertUnprocessable()->assertJsonValidationErrors(['to'], 'error.details');
        $this->send($sale, ['channel' => 'fax'])->assertUnprocessable()->assertJsonValidationErrors(['channel'], 'error.details');

        $this->assertSame(3, SaleReceiptDelivery::query()->withoutGlobalScopes()->count());
    }

    public function test_sms_must_be_set_up_and_the_receipt_text_switched_on(): void
    {
        $sale = $this->sell($this->rahim->id);

        $this->send($sale, ['channel' => 'sms'])->assertUnprocessable()->assertJsonPath('error.code', 'SMS_NOT_READY');

        $this->enableSms(['templates' => ['sale_receipt' => ['enabled' => false]]]);
        $this->send($sale, ['channel' => 'sms'])->assertUnprocessable()->assertJsonPath('error.code', 'SMS_TEMPLATE_OFF');
        $this->assertSame(0, SaleReceiptDelivery::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, SmsMessage::query()->withoutGlobalScopes()->count());

        // Without a store the text carries no link; over the monthly limit the message is skipped.
        $this->enableSms(['templates' => ['sale_receipt' => ['enabled' => true]], 'monthly_limit' => 1]);
        $this->send($sale, ['channel' => 'sms'])->assertCreated()->assertJsonPath('data.status', 'queued');
        $this->assertStringNotContainsString('/receipt/', SmsMessage::query()->withoutGlobalScopes()->sole()->body);
        $this->send($sale, ['channel' => 'sms'])->assertCreated()->assertJsonPath('data.status', 'skipped');
    }

    public function test_the_sms_settings_list_the_sale_receipt_template(): void
    {
        $data = $this->getJson('/api/v1/sms/settings')->assertOk()->json('data');

        $this->assertTrue($data['templates']['sale_receipt']['enabled']);
        $this->assertSame(SmsTemplate::defaults()['sale_receipt'], $data['templates']['sale_receipt']);
        $this->assertSame(SmsTemplate::defaults()['sale_receipt'], $data['default_templates']['sale_receipt']);
        $this->assertContains('invoice', $data['placeholders']);
        $this->patchJson('/api/v1/sms/settings', ['templates' => ['sale_receipt' => ['en' => '{shop}: {invoice} {total}']]])->assertOk()
            ->assertJsonPath('data.templates.sale_receipt.en', '{shop}: {invoice} {total}');
    }

    public function test_a_receipt_is_sent_by_e_mail(): void
    {
        Mail::fake();
        $this->openShop();
        $sale = $this->sell($this->rahim->id);
        $number = $this->getJson("/api/v1/sales/{$sale}")->assertOk()
            // The sale page defaults the recipient to the customer's phone / e-mail.
            ->assertJsonPath('data.customer.phone', '01712345678')
            ->assertJsonPath('data.customer.email', 'rahim@example.test')
            ->json('data.number');

        $this->send($sale, ['channel' => 'email'])->assertCreated()
            ->assertJsonPath('data', ['channel' => 'email', 'recipient_masked' => 'ra•••@example.test', 'status' => 'queued']);
        $token = SaleReceiptLink::query()->withoutGlobalScopes()->value('token');

        Mail::assertQueued(SaleReceiptMail::class, function (SaleReceiptMail $mail) use ($number, $token) {
            $html = $mail->receiptHtml();

            return $mail->hasTo('rahim@example.test')
                && $mail->envelope()->from?->name === 'Alpha'
                && str_contains((string) $mail->envelope()->subject, $number)
                && str_contains($html, 'Mango Juice')
                && str_contains($html, '30.00 BDT')
                && str_contains($html, $this->siteUrl().'/receipt/'.$token)
                && ! str_contains($html, '9.25')
                && $mail->afterCommit === true;
        });

        // Another address; then without a store: the receipt in full, no link.
        $this->send($sale, ['channel' => 'email', 'to' => 'k@example.org'])->assertCreated()->assertJsonPath('data.recipient_masked', 'k•••@example.org');
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => false])->assertOk();
        $this->send($sale, ['channel' => 'email', 'to' => 'shop.owner@example.org'])->assertCreated();
        Mail::assertQueued(SaleReceiptMail::class, fn (SaleReceiptMail $mail) => $mail->hasTo('shop.owner@example.org')
            && $mail->receiptUrl === null && str_contains($mail->receiptHtml(), 'Mango Juice') && ! str_contains($mail->receiptHtml(), '/receipt/'));
        Mail::assertQueuedCount(3);

        $this->send($sale, ['channel' => 'email', 'to' => 'not-an-address'])->assertUnprocessable()->assertJsonValidationErrors(['to'], 'error.details');
        $this->send($this->sell(), ['channel' => 'email'])->assertUnprocessable()->assertJsonValidationErrors(['to'], 'error.details');
    }

    public function test_at_most_five_sends_per_sale_listed_on_the_sale_newest_first(): void
    {
        Mail::fake();
        $sale = $this->sell($this->rahim->id);

        for ($i = 0; $i < 5; $i++) {
            $this->travel(1)->seconds();
            $this->send($sale, ['channel' => 'email', 'to' => "guest{$i}@example.org"])->assertCreated();
        }
        $this->send($sale, ['channel' => 'email'])->assertUnprocessable()
            ->assertJsonPath('error.code', 'RECEIPT_SEND_LIMIT')->assertJsonPath('error.details.max', 5);
        Mail::assertQueuedCount(5);

        $deliveries = $this->getJson("/api/v1/sales/{$sale}")->assertOk()->json('data.receipt_deliveries');
        $this->assertCount(5, $deliveries);
        $this->assertSame(['channel', 'recipient_masked', 'status', 'created_by_name', 'created_at'], array_keys($deliveries[0]));
        $this->assertSame(['gu•••@example.org', 'email', 'queued', 'Owner of Alpha'], [
            $deliveries[0]['recipient_masked'], $deliveries[0]['channel'], $deliveries[0]['status'], $deliveries[0]['created_by_name'],
        ]);
        $times = array_column($deliveries, 'created_at');
        $sorted = $times;
        rsort($sorted);
        $this->assertSame($sorted, $times);

        // Another sale's document lists none.
        $this->getJson('/api/v1/sales/'.$this->sell())->assertOk()->assertJsonPath('data.receipt_deliveries', []);

        // Append-only.
        $this->expectException(LogicException::class);
        $this->inTenant($this->org, fn () => SaleReceiptDelivery::query()->firstOrFail()->update(['status' => 'failed']));
    }

    public function test_sending_is_throttled_per_user(): void
    {
        Mail::fake();
        $sales = [$this->sell($this->rahim->id), $this->sell($this->rahim->id), $this->sell($this->rahim->id)];

        foreach ([0, 0, 0, 0, 0, 1, 1, 1, 1, 1] as $i) {
            $this->send($sales[$i], ['channel' => 'email'])->assertCreated();
        }
        $this->send($sales[2], ['channel' => 'email'])->assertStatus(429);
    }

    public function test_permissions_branch_access_and_other_organizations(): void
    {
        Mail::fake();
        $sale = $this->sell($this->rahim->id);

        // An accountant sees sales but does not sell: the link yes, sending no.
        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::Accountant, [$this->branchId]));
        $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertOk();
        $this->send($sale, ['channel' => 'email'])->assertForbidden();

        // A cashier of another branch.
        $other = $this->createBranch($this->org, 'B2');
        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::Cashier, [$other->id]));
        $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertNotFound();
        $this->send($sale, ['channel' => 'email'])->assertNotFound();

        // A cashier of the branch may send.
        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::Cashier, [$this->branchId]));
        $this->send($sale, ['channel' => 'email'])->assertCreated();

        // Another organization's staff.
        ['admin' => $betaAdmin] = $this->provisionTenant('Beta');
        $this->actingAsUser($betaAdmin);
        $this->getJson("/api/v1/sales/{$sale}/receipt-link")->assertNotFound();
        $this->send($sale, ['channel' => 'email'])->assertNotFound();
        $this->assertSame(1, SaleReceiptDelivery::query()->withoutGlobalScopes()->count());
    }

    public function test_recipients_are_masked_in_the_audit_trail_and_deliveries(): void
    {
        Mail::fake();
        $this->enableSms();
        $sale = $this->sell($this->rahim->id);

        $this->send($sale, ['channel' => 'sms'])->assertCreated();
        $this->send($sale, ['channel' => 'email'])->assertCreated();

        $audits = AuditLog::query()->withoutGlobalScopes()->where('action', 'sale.receipt_sent')->orderBy('created_at')->get();
        $this->assertCount(2, $audits);
        $this->assertEquals(['channel' => 'sms', 'recipient' => '017••••678', 'status' => 'queued'], $audits[0]->new_values);
        $this->assertSame('ra•••@example.test', $audits[1]->new_values['recipient']);
        $this->assertSame($sale, $audits[0]->subject_id);

        $everything = AuditLog::query()->withoutGlobalScopes()->where('action', 'sale.receipt_sent')->get()->toJson(JSON_UNESCAPED_UNICODE)
            .SaleReceiptDelivery::query()->withoutGlobalScopes()->get()->toJson(JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString('01712345678', $everything);
        $this->assertStringNotContainsString('rahim@example.test', $everything);
    }

    public function test_the_store_serves_the_receipt_page_unindexed(): void
    {
        $this->openShop();
        $token = $this->getJson('/api/v1/sales/'.$this->sell().'/receipt-link')->assertOk()->json('data.token');
        $shell = sys_get_temp_dir().'/storefront-shell-'.Str::random(6).'.html';
        file_put_contents($shell, '<html><head><title>x</title></head><body></body></html>');
        config(['storefront.shell_path' => $shell]);

        $this->app['auth']->forgetGuards();
        $this->get('http://'.self::HOST.'/receipt/'.$token)->assertOk()->assertHeader('X-Robots-Tag', 'noindex');
        $this->get('http://'.self::HOST.'/receipt/short')->assertNotFound();
        @unlink($shell);
    }
}
