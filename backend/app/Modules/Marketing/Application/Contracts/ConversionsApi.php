<?php

namespace App\Modules\Marketing\Application\Contracts;

/**
 * BD1c: sends events to Meta's Conversions API for a pixel. `status` sent | failed; `error` a
 * short reason without the access token (≤ 200 characters); `retryable` for connection
 * failures, 429 and 5xx answers.
 */
interface ConversionsApi
{
    /**
     * @param  array<string, mixed>  $event  MetaConversionEvent::purchase() / pageView()
     * @return array{status: 'sent'|'failed', error: ?string, retryable: bool}
     */
    public function send(string $pixelId, string $accessToken, array $event, ?string $testEventCode): array;
}
