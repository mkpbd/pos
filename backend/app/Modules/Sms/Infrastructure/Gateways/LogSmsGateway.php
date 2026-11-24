<?php

namespace App\Modules\Sms\Infrastructure\Gateways;

use App\Modules\Sms\Application\Contracts\SmsGateway;
use App\Modules\Sms\Application\Data\SmsResult;
use App\Modules\Sms\Application\Data\SmsSettingsData;
use Illuminate\Support\Facades\Log;

/**
 * BD1a: test mode — writes the message to the `sms` log channel (storage/logs/sms.log) instead
 * of sending it. Always succeeds.
 */
final class LogSmsGateway implements SmsGateway
{
    public const DRIVER = 'log';

    public function send(SmsSettingsData $settings, string $phone, string $text, string $purpose = 'test'): SmsResult
    {
        Log::channel('sms')->info('SMS (test mode, not sent)', [
            'organization_id' => $settings->organizationId,
            'to' => $phone,
            'purpose' => $purpose,
            'text' => $text,
        ]);

        return SmsResult::sent(null, 'logged');
    }
}
