<?php

namespace App\Modules\Sms\Application\Data;

/**
 * BD1a: a gateway's answer. `response` is the provider's body (already truncated and without the
 * API key); `retryable` failures (connection errors, 429, 5xx) are worth another try.
 */
final readonly class SmsResult
{
    public function __construct(
        public bool $ok,
        public ?int $providerStatus = null,
        public ?string $response = null,
        public ?string $error = null,
        public bool $retryable = false,
    ) {}

    public static function sent(?int $status = null, ?string $response = null): self
    {
        return new self(true, $status, $response);
    }

    public static function failed(string $error, ?int $status = null, ?string $response = null, bool $retryable = false): self
    {
        return new self(false, $status, $response, $error, $retryable);
    }
}
