<?php

namespace App\Modules\Sms\Presentation\Http\Support;

use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Infrastructure\Models\SmsSettings;

/**
 * BD1a: API shapes of the SMS settings (the API key never leaves the server: only `api_key_set`)
 * and of the message log.
 */
class SmsPresenter
{
    public function __construct(private readonly SmsConfig $config) {}

    /**
     * @return array<string, mixed>
     */
    public function settings(SmsSettings $settings): array
    {
        return [
            'is_enabled' => (bool) $settings->is_enabled,
            'driver' => $settings->driver,
            'http_url' => $settings->http_url,
            'http_method' => $settings->http_method,
            'http_body' => $settings->http_body,
            'param_to' => $settings->param_to,
            'param_message' => $settings->param_message,
            'param_sender' => $settings->param_sender,
            'param_api_key' => $settings->param_api_key,
            'api_key_set' => is_string($settings->api_key) && $settings->api_key !== '',
            'sender_id' => $settings->sender_id,
            'extra_params' => (object) ($settings->extra_params ?? []),
            'success_contains' => $settings->success_contains,
            'phone_format' => $settings->phone_format,
            'monthly_limit' => $settings->monthly_limit,
            'templates' => SmsTemplate::effective($settings->templates),
            'default_templates' => SmsTemplate::defaults(),
            'placeholders' => SmsTemplate::PLACEHOLDERS,
            'ready' => SmsConfig::ready($settings),
            'otp_ready' => SmsConfig::otpReady($settings),
            'usage' => $this->config->usage((string) $settings->organization_id),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function message(SmsMessage $message): array
    {
        return [
            'id' => $message->id,
            'to_phone' => $message->to_phone,
            'purpose' => $message->purpose,
            'body' => $message->body,
            'segments' => $message->segments,
            'encoding' => $message->encoding,
            'driver' => $message->driver,
            'status' => $message->status,
            'error' => $message->error,
            'attempts' => $message->attempts,
            'created_at' => $message->created_at?->toIso8601String(),
            'sent_at' => $message->sent_at?->toIso8601String(),
            'related' => $message->related_type !== null ? ['type' => $message->related_type, 'id' => $message->related_id] : null,
        ];
    }
}
