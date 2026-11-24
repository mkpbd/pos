<?php

namespace App\Modules\Marketing\Infrastructure\Meta;

use App\Modules\Marketing\Application\Contracts\ConversionsApi;
use App\Modules\Marketing\Domain\MetaConversionEvent;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * BD1c: Meta's Conversions API over Laravel's HTTP client — one JSON POST to the fixed Graph API
 * host (no SSRF surface: only the pixel id, digits, goes into the URL), 10 s timeout, redirects
 * never followed. The access token travels in the body and is removed from every stored or
 * logged error; logs hold only the pixel id, the HTTP status and the error.
 */
final class MetaConversionsClient implements ConversionsApi
{
    private const ERROR_MAX = 200;

    public function __construct(private readonly HttpFactory $http) {}

    public function send(string $pixelId, string $accessToken, array $event, ?string $testEventCode): array
    {
        $body = MetaConversionEvent::json(MetaConversionEvent::body($event, $accessToken, $testEventCode));

        try {
            $response = $this->http->withoutRedirecting()
                ->timeout(10)
                ->connectTimeout(5)
                ->acceptJson()
                ->withBody($body, 'application/json')
                ->post(MetaConversionEvent::url($pixelId));
        } catch (ConnectionException) {
            return $this->failed($pixelId, null, 'connection_failed', true);
        } catch (Throwable) {
            return $this->failed($pixelId, null, 'request_failed', true);
        }

        $status = $response->status();
        if ($response->successful()) {
            Log::info('Meta Conversions API accepted an event', ['pixel_id' => $pixelId, 'status' => $status, 'event' => $event['event_name'] ?? null]);

            return ['status' => 'sent', 'error' => null, 'retryable' => false];
        }

        $message = $response->json('error.message');
        $error = $status >= 300 && $status < 400 ? 'redirect_refused' : 'http_'.$status;
        if (is_string($message) && trim($message) !== '') {
            $error .= ': '.self::clean($message, $accessToken);
        }

        return $this->failed($pixelId, $status, $error, $status === 429 || $status >= 500);
    }

    /**
     * An error text without the token (raw or URL-encoded), on one line, ≤ 200 characters.
     */
    public static function clean(string $text, string $accessToken): string
    {
        if ($accessToken !== '') {
            $text = str_replace(array_unique([$accessToken, rawurlencode($accessToken), urlencode($accessToken)]), '[hidden]', $text);
        }
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        return mb_strlen($text) > self::ERROR_MAX ? mb_substr($text, 0, self::ERROR_MAX - 1).'…' : $text;
    }

    /**
     * @return array{status: 'failed', error: string, retryable: bool}
     */
    private function failed(string $pixelId, ?int $status, string $error, bool $retryable): array
    {
        $error = mb_strlen($error) > self::ERROR_MAX ? mb_substr($error, 0, self::ERROR_MAX - 1).'…' : $error;
        Log::warning('Meta Conversions API error', ['pixel_id' => $pixelId, 'status' => $status, 'error' => $error]);

        return ['status' => 'failed', 'error' => $error, 'retryable' => $retryable];
    }
}
