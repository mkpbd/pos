<?php

namespace App\Modules\Sms\Application\Contracts;

use App\Modules\Sms\Application\Data\SmsResult;
use App\Modules\Sms\Application\Data\SmsSettingsData;

/**
 * BD1a: delivers one text to one phone (01XXXXXXXXX) with the organization's settings
 * ($purpose is the message purpose, for logs). Never throws for delivery problems: they come
 * back as a failed SmsResult.
 */
interface SmsGateway
{
    public function send(SmsSettingsData $settings, string $phone, string $text, string $purpose = 'test'): SmsResult;
}
