<?php

namespace App\Modules\Customers\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * R1: due (বাকি) reminders — the `due_reminder` SMS template, sending one now from the customer
 * page, the scheduled weekly / monthly reminders and the WhatsApp click-to-chat link.
 */
class DueReminderTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private const HOST = 'alpha-shop.test';

    private Organization $org;

    private User $admin;

    private string $branchId;

    private Customer $rahim;

    protected function setUp(): void
    {
        parent::setUp();
        config(['logging.channels.sms' => config('logging.channels.null')]);

        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant('Alpha');
        $this->branchId = $branch->id;
        $this->actingAsUser($this->admin);

        // Owes 250.00 opening balance + 20.00 from a sale on credit = 270.00.
        $this->rahim = $this->withPhone($this->customer($this->org, 'Rahim Uddin', '1000', null, '250'), '+880 1712-345678');
        $juice = $this->sellable($this->org, 'Mango Juice', '15.00');
        $store = $this->mainStoreId($this->org);
        $this->stockUp($store, $juice, '10');
        $this->checkout($this->cart($store, [[$juice, '2']], [['cash', '10']], ['customer_id' => $this->rahim->id]))->assertCreated();
    }

    private function withPhone(Customer $customer, ?string $phone): Customer
    {
        $this->inTenant($this->org, fn () => $customer->forceFill(['phone' => $phone])->save());

        return $customer;
    }

    private function enableSms(array $settings = []): void
    {
        $this->patchJson('/api/v1/sms/settings', $settings + ['is_enabled' => true, 'driver' => 'log'])->assertOk();
    }

    private function send(Customer $customer): TestResponse
    {
        return $this->postJson("/api/v1/customers/{$customer->id}/due-reminder");
    }

    /** @return list<SmsMessage> */
    private function messages(): array
    {
        return SmsMessage::query()->withoutGlobalScopes()->where('purpose', 'due_reminder')->orderBy('created_at')->get()->all();
    }

    public function test_the_sms_settings_list_the_due_reminder_template(): void
    {
        $data = $this->getJson('/api/v1/sms/settings')->assertOk()->json('data');

        $this->assertTrue($data['templates']['due_reminder']['enabled']);
        $this->assertSame(SmsTemplate::defaults()['due_reminder'], $data['templates']['due_reminder']);
        $this->assertSame('{shop}: Dear {name}, your due balance is Tk {due}. Please pay at your earliest convenience. {link}', $data['default_templates']['due_reminder']['en']);
        $this->assertStringContainsString('৳{due}', $data['default_templates']['due_reminder']['bn']);
        $this->assertContains('due', $data['placeholders']);
        $this->patchJson('/api/v1/sms/settings', ['templates' => ['due_reminder' => ['en' => '{name} owes {due}']]])->assertOk()
            ->assertJsonPath('data.templates.due_reminder.en', '{name} owes {due}');
        $this->assertSame('Rahim owes 1,200.50', SmsTemplate::render('{name} owes {due}', ['name' => 'Rahim', 'due' => '1,200.50']));
    }

    public function test_a_reminder_is_sent_now_masked_and_audited(): void
    {
        $this->enableSms();

        $this->send($this->rahim)->assertCreated()
            ->assertJsonPath('data', ['recipient_masked' => '017••••678', 'status' => 'queued', 'due' => '270.00']);
        [$message] = $this->messages();
        $this->assertSame(['01712345678', 'customer', $this->rahim->id], [$message->to_phone, $message->related_type, $message->related_id]);
        $this->assertSame('Alpha: Dear Rahim Uddin, your due balance is Tk 270.00. Please pay at your earliest convenience.', $message->body);

        // With an open online store the text links to the account page; Bangla when it is the store's language.
        $this->postJson('/api/v1/storefront/domains', ['host' => self::HOST])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => 'Alpha Shop', 'is_enabled' => true, 'bangla_enabled' => true, 'default_locale' => 'bn'])->assertOk();
        $this->send($this->rahim)->assertCreated();
        $site = (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https').'://'.self::HOST;
        $this->assertContains("Alpha Shop: প্রিয় Rahim Uddin, আপনার বাকি ৳270.00। অনুগ্রহ করে শীঘ্রই পরিশোধ করুন। {$site}/account", array_map(fn (SmsMessage $m) => $m->body, $this->messages()));

        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'customer.due_reminder_sent')->orderBy('created_at')->first();
        $this->assertEquals(['recipient' => '017••••678', 'status' => 'queued', 'due' => '270.00'], $audit->new_values);
        $this->assertSame($this->rahim->id, $audit->subject_id);
        $this->assertStringNotContainsString('345678', AuditLog::query()->withoutGlobalScopes()->where('action', 'customer.due_reminder_sent')->get()->toJson());
    }

    public function test_errors_no_phone_no_due_sms_not_ready_and_text_off(): void
    {
        $this->send($this->rahim)->assertUnprocessable()->assertJsonPath('error.code', 'SMS_NOT_READY');

        $this->enableSms(['templates' => ['due_reminder' => ['enabled' => false]]]);
        $this->send($this->rahim)->assertUnprocessable()->assertJsonPath('error.code', 'SMS_TEMPLATE_OFF');

        $this->enableSms(['templates' => ['due_reminder' => ['enabled' => true]]]);
        $nobody = $this->withPhone($this->customer($this->org, 'No Phone', '0', null, '500'), null);
        $this->send($nobody)->assertUnprocessable()->assertJsonValidationErrors(['phone'], 'error.details');
        $landline = $this->withPhone($this->customer($this->org, 'Landline', '0', null, '500'), '029876543');
        $this->send($landline)->assertUnprocessable()->assertJsonValidationErrors(['phone'], 'error.details');
        $settled = $this->withPhone($this->customer($this->org, 'Settled', '0', null, '0'), '01812345679');
        $this->send($settled)->assertUnprocessable()->assertJsonPath('error.code', 'NO_DUE');
        $this->assertSame([], $this->messages());
    }

    public function test_permissions_throttle_and_other_organizations(): void
    {
        $this->enableSms();

        // Stock staff may neither collect payments nor manage customers.
        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::InventoryManager, [$this->branchId]));
        $this->send($this->rahim)->assertForbidden();

        // A cashier collects payments: may send (10 a minute).
        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::Cashier, [$this->branchId]));
        foreach (range(1, 10) as $ignored) {
            $this->send($this->rahim)->assertCreated();
        }
        $this->send($this->rahim)->assertStatus(429);

        ['admin' => $betaAdmin] = $this->provisionTenant('Beta');
        $this->actingAsUser($betaAdmin);
        $this->send($this->rahim)->assertNotFound();
        $this->assertCount(10, $this->messages());
    }

    public function test_the_whatsapp_link_on_the_customer_page(): void
    {
        $url = $this->getJson("/api/v1/customers/{$this->rahim->id}")->assertOk()->json('data.whatsapp_reminder_url');
        $text = 'Alpha: Dear Rahim Uddin, your due balance is Tk 270.00. Please pay at your earliest convenience.';
        $this->assertSame('https://wa.me/8801712345678?text='.rawurlencode($text), $url);
        $this->assertStringContainsString('text=Alpha%3A%20Dear%20Rahim%20Uddin%2C%20your%20due%20balance%20is%20Tk%20270.00.', $url);

        // Bangla text, encoded.
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => true, 'default_locale' => 'bn'])->assertOk();
        $url = $this->getJson("/api/v1/customers/{$this->rahim->id}")->json('data.whatsapp_reminder_url');
        $this->assertSame('Alpha: প্রিয় Rahim Uddin, আপনার বাকি ৳270.00। অনুগ্রহ করে শীঘ্রই পরিশোধ করুন।', rawurldecode(explode('?text=', $url)[1]));

        // No mobile number or nothing owed: no link; the list does not carry it.
        $this->withPhone($this->rahim, '029876543');
        $this->assertNull($this->getJson("/api/v1/customers/{$this->rahim->id}")->json('data.whatsapp_reminder_url'));
        $settled = $this->withPhone($this->customer($this->org, 'Settled', '0', null, '0'), '01812345679');
        $this->assertNull($this->getJson("/api/v1/customers/{$settled->id}")->json('data.whatsapp_reminder_url'));
        $this->assertArrayNotHasKey('whatsapp_reminder_url', $this->getJson('/api/v1/customers')->json('data.0'));
    }

    public function test_scheduled_weekly_reminders_from_10_on_the_weekday_once_a_day(): void
    {
        $this->enableSms();
        $karim = $this->withPhone($this->customer($this->org, 'Karim', '0', null, '50'), '01812345670');   // under the minimum
        $this->withPhone($this->customer($this->org, 'No Phone', '0', null, '500'), null);
        $this->withPhone($this->customer($this->org, 'Landline', '0', null, '500'), '029876543');
        $this->withPhone($this->customer($this->org, 'Settled', '0', null, '0'), '01912345671');

        // Off by default.
        $this->travelTo(CarbonImmutable::parse('2026-11-07 05:00:00', 'UTC')); // Saturday 11:00 in Dhaka
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 0 due reminder(s).')->assertSuccessful();

        $this->patchJson('/api/v1/settings/alerts', ['due_reminders' => 'weekly'])->assertOk(); // Saturdays, from 100.00
        $this->travelTo(CarbonImmutable::parse('2026-11-06 05:00:00', 'UTC')); // Friday
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 0 due reminder(s).');
        $this->travelTo(CarbonImmutable::parse('2026-11-07 03:30:00', 'UTC')); // Saturday 09:30
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 0 due reminder(s).');
        $this->travelTo(CarbonImmutable::parse('2026-11-07 04:30:00', 'UTC')); // Saturday 10:30
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 1 due reminder(s).');
        $this->assertSame(['01712345678'], array_map(fn (SmsMessage $m) => $m->to_phone, $this->messages()));
        $this->assertSame('Alpha: Dear Rahim Uddin, your due balance is Tk 270.00. Please pay at your earliest convenience.', $this->messages()[0]->body);

        // Once a day, even with a lower minimum later that day.
        $this->patchJson('/api/v1/settings/alerts', ['due_reminder_min' => '50'])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2026-11-07 08:00:00', 'UTC'));
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 0 due reminder(s).');

        // Next Saturday: Karim owes the new minimum.
        $this->travelTo(CarbonImmutable::parse('2026-11-14 05:00:00', 'UTC'));
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 2 due reminder(s).');
        $this->assertContains($karim->id, array_map(fn (SmsMessage $m) => $m->related_id, $this->messages()));

        // Another weekday.
        $this->patchJson('/api/v1/settings/alerts', ['due_reminder_weekday' => 1])->assertOk(); // Mondays
        $this->travelTo(CarbonImmutable::parse('2026-11-16 05:00:00', 'UTC'));
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 2 due reminder(s).');
    }

    public function test_scheduled_monthly_reminders_sms_not_ready_and_other_organizations(): void
    {
        ['admin' => $betaAdmin, 'organization' => $beta] = $this->provisionTenant('Beta');
        $this->actingAsUser($betaAdmin);
        $this->patchJson('/api/v1/sms/settings', ['is_enabled' => true, 'driver' => 'log'])->assertOk();
        $betaCustomer = $this->customer($beta, 'Beta Buyer', '0', null, '900');
        $this->inTenant($beta, fn () => $betaCustomer->forceFill(['phone' => '01512345678'])->save());

        // Alpha: monthly, but SMS is not set up — skipped and logged.
        $this->actingAsUser($this->admin)->patchJson('/api/v1/settings/alerts', ['due_reminders' => 'monthly'])->assertOk();
        $logger = Log::getFacadeRoot();
        Log::spy();
        $this->travelTo(CarbonImmutable::parse('2026-12-01 05:00:00', 'UTC'));
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 0 due reminder(s).');
        Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context) => str_contains($message, 'SMS_NOT_READY') && $context === ['organization_id' => $this->org->id])->once();
        Log::swap($logger);

        // Set up later the same day: sent (the skipped run claimed nothing); Beta's reminders are off.
        $this->enableSms();
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 1 due reminder(s).');
        $this->travelTo(CarbonImmutable::parse('2026-12-02 05:00:00', 'UTC'));
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 0 due reminder(s).');
        $this->assertSame([$this->rahim->id], array_map(fn (SmsMessage $m) => $m->related_id, $this->messages()));

        // Beta monthly too: only Beta's own customers.
        $this->actingAsUser($betaAdmin)->patchJson('/api/v1/settings/alerts', ['due_reminders' => 'monthly'])->assertOk();
        $this->travelTo(CarbonImmutable::parse('2027-01-01 05:00:00', 'UTC'));
        $this->artisan('customers:due-reminders')->expectsOutputToContain('Queued 2 due reminder(s).');
        $beta = SmsMessage::query()->withoutGlobalScopes()->where('organization_id', $beta->id)->where('purpose', 'due_reminder')->get();
        $this->assertSame([$betaCustomer->id], $beta->pluck('related_id')->all());
    }

    public function test_the_command_is_scheduled_hourly(): void
    {
        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'customers:due-reminders'));

        $this->assertNotNull($event);
        $this->assertSame('0 * * * *', $event->expression);
    }
}
