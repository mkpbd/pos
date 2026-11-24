<?php

namespace App\Modules\Sms\Application\Data;

use App\Modules\Sms\Infrastructure\Models\SmsSettings;

/**
 * BD1a: what a gateway needs to send (a snapshot of the organization's settings).
 */
final readonly class SmsSettingsData
{
    /**
     * @param  array<string, string>  $extraParams
     */
    public function __construct(
        public string $organizationId,
        public string $driver,
        public ?string $httpUrl = null,
        public string $httpMethod = 'POST',
        public string $httpBody = 'form',
        public string $paramTo = 'to',
        public string $paramMessage = 'message',
        public ?string $paramSender = null,
        public ?string $paramApiKey = null,
        public ?string $apiKey = null,
        public ?string $senderId = null,
        public array $extraParams = [],
        public ?string $successContains = null,
        public string $phoneFormat = '880',
    ) {}

    public static function fromModel(SmsSettings $settings): self
    {
        $extra = [];
        foreach ((array) ($settings->extra_params ?? []) as $key => $value) {
            $extra[(string) $key] = (string) $value;
        }

        return new self(
            organizationId: (string) $settings->organization_id,
            driver: $settings->driver,
            httpUrl: $settings->http_url,
            httpMethod: $settings->http_method,
            httpBody: $settings->http_body,
            paramTo: $settings->param_to,
            paramMessage: $settings->param_message,
            paramSender: $settings->param_sender,
            paramApiKey: $settings->param_api_key,
            apiKey: $settings->api_key,
            senderId: $settings->sender_id,
            extraParams: $extra,
            successContains: $settings->success_contains,
            phoneFormat: $settings->phone_format,
        );
    }
}
