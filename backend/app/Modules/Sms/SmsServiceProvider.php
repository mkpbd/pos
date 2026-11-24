<?php

namespace App\Modules\Sms;

use App\Modules\Shared\Application\Contracts\RetentionTask;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Sms\Application\Services\OtpCodes;
use App\Modules\Sms\Application\Services\SmsMessenger;
use App\Modules\Sms\Infrastructure\Gateways\DnsHostResolver;
use App\Modules\Sms\Infrastructure\Gateways\HostResolver;
use App\Modules\Sms\Infrastructure\Retention\PruneSmsRecords;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * BD1a: text messages — the organization's SMS gateway (test mode writing to the `sms` log, or a
 * generic HTTP SMS provider behind an SSRF guard), order message templates, the message log,
 * one-time phone codes (PhoneVerification) and the SmsSender other modules queue messages with.
 * Reads the shop name through Storefront StorefrontConfig and Organizations OrganizationDirectory.
 */
class SmsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(SmsSender::class, SmsMessenger::class);
        $this->app->bind(PhoneVerification::class, OtpCodes::class);
        $this->app->bind(HostResolver::class, DnsHostResolver::class);
        $this->app->tag([PruneSmsRecords::class], RetentionTask::TAG);
    }

    public function boot(): void
    {
        parent::boot();

        // Each test message costs money: a few per staff member.
        RateLimiter::for('sms-test', fn (Request $request) => Limit::perMinute(5)->by('sms-test|'.($request->user()?->getAuthIdentifier() ?: $request->ip())));
    }

    protected function permissions(): array
    {
        return [
            'sms.view' => 'View the SMS settings, message templates and the message log',
            'sms.manage' => 'Set up the SMS gateway and message templates and send test messages',
        ];
    }
}
