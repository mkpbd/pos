<?php

namespace App\Modules\Sms\Application\Actions;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Domain\SmsText;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;

/**
 * BD1a: sends a test message right away (not queued) with the saved settings and reports the
 * gateway's answer. Logged with purpose `test`. SMS_UNAVAILABLE when SMS is off or not set up.
 */
class SendTestSms
{
    public const DEFAULT_MESSAGE = '{shop}: test message from your POS.';

    public function __construct(
        private readonly SmsConfig $config,
        private readonly TenantContext $tenant,
        private readonly DeliverSmsMessage $deliver,
    ) {}

    /**
     * @param  string  $phone  normalized 01XXXXXXXXX
     * @return array{status: string, error: ?string, provider_status: ?int, provider_response: ?string, segments: int, encoding: string}
     */
    public function __invoke(string $phone, ?string $message): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $settings = $this->config->settings($organizationId);
        if (! SmsConfig::ready($settings)) {
            throw new BusinessRuleViolation('SMS_UNAVAILABLE', 'Switch SMS on and finish the gateway settings first.');
        }

        $template = $message !== null && trim($message) !== '' ? $message : self::DEFAULT_MESSAGE;
        $text = SmsTemplate::render($template, ['shop' => $this->config->shopName($organizationId)]);
        $analysis = SmsText::analyze($text);

        $row = SmsMessage::query()->create([
            'to_phone' => $phone,
            'purpose' => 'test',
            'body' => $text,
            'segments' => $analysis['segments'],
            'encoding' => $analysis['encoding'],
            'driver' => $settings->driver,
            'status' => 'queued',
        ]);
        ($this->deliver)($row->id, null, true);
        $row->refresh();

        return [
            'status' => $row->status,
            'error' => $row->error,
            'provider_status' => $row->provider_status,
            'provider_response' => $row->provider_response,
            'segments' => $row->segments,
            'encoding' => $row->encoding,
        ];
    }
}
