<?php

namespace App\Modules\Sms\Infrastructure\Gateways;

use App\Modules\Sms\Application\Contracts\SmsGateway;
use App\Modules\Sms\Application\Data\SmsResult;
use App\Modules\Sms\Application\Data\SmsSettingsData;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * BD1a: a generic HTTP SMS gateway (most Bangladeshi providers: one GET or POST with the
 * number, text, sender id and API key as parameters) over Laravel's HTTP client — no vendor SDK.
 *
 * Parameters: {param_to: phone (per phone_format), param_message: text, param_sender?:
 * sender_id, param_api_key?: api_key} + extra_params; GET → query string, POST → form or JSON
 * body. Redirects are never followed. Success = 2xx and, when `success_contains` is set, the
 * body contains it. Connection errors, 429 and 5xx are retryable. Every request first passes
 * the HostGuard (SSRF) and is pinned to the checked address. The API key is never logged and
 * is removed from the stored provider response; logs hold only the host, status and error.
 */
final class HttpSmsGateway implements SmsGateway
{
    public const DRIVER = 'http';

    private const RESPONSE_MAX = 500;

    public function __construct(
        private readonly HttpFactory $http,
        private readonly HostGuard $guard,
    ) {}

    public function send(SmsSettingsData $settings, string $phone, string $text, string $purpose = 'test'): SmsResult
    {
        $url = trim((string) $settings->httpUrl);
        if ($url === '') {
            return SmsResult::failed('not_configured');
        }

        $target = $this->guard->inspect($url);
        if ($target['error'] !== null) {
            $this->log($target['host'], null, $target['error']);

            return SmsResult::failed($target['error'], retryable: $target['retryable']);
        }

        $params = $this->params($settings, $phone, $text);
        $request = $this->http->withoutRedirecting()
            ->timeout((int) config('sms.timeout', 10))
            ->connectTimeout((int) config('sms.connect_timeout', 5))
            ->withHeaders(['Accept' => 'application/json, text/plain, */*']);
        if (filter_var($target['host'], FILTER_VALIDATE_IP) === false && defined('CURLOPT_RESOLVE')) {
            // Connect to the address the guard checked (no second DNS answer, no rebinding).
            $ip = $target['ips'][0];
            $pinned = $target['host'].':'.$target['port'].':'.(str_contains($ip, ':') ? '['.$ip.']' : $ip);
            $request = $request->withOptions(['curl' => [CURLOPT_RESOLVE => [$pinned]]]);
        }

        try {
            $response = match (true) {
                $settings->httpMethod === 'GET' => $request->get($url, $params),
                $settings->httpBody === 'json' => $request->asJson()->post($url, $params),
                default => $request->asForm()->post($url, $params),
            };
        } catch (ConnectionException) {
            $this->log($target['host'], null, 'connection_failed');

            return SmsResult::failed('connection_failed', retryable: true);
        } catch (Throwable) {
            $this->log($target['host'], null, 'request_failed');

            return SmsResult::failed('request_failed', retryable: true);
        }

        return $this->result($settings, $target['host'], $response);
    }

    /**
     * @return array<string, string>
     */
    public function params(SmsSettingsData $settings, string $phone, string $text): array
    {
        $params = [
            $settings->paramTo => self::formatPhone($phone, $settings->phoneFormat),
            $settings->paramMessage => $text,
        ];
        if (self::filled($settings->paramSender) && self::filled($settings->senderId)) {
            $params[(string) $settings->paramSender] = (string) $settings->senderId;
        }
        if (self::filled($settings->paramApiKey) && self::filled($settings->apiKey)) {
            $params[(string) $settings->paramApiKey] = (string) $settings->apiKey;
        }

        return $params + $settings->extraParams;
    }

    /**
     * 01712345678 as `local` (01712345678), `880` (8801712345678) or `plus880` (+8801712345678).
     */
    public static function formatPhone(string $phone, string $format): string
    {
        $national = substr($phone, 1);

        return match ($format) {
            'local' => $phone,
            'plus880' => '+880'.$national,
            default => '880'.$national,
        };
    }

    /**
     * The provider's answer as stored: without the API key (raw or URL-encoded), truncated.
     */
    public static function clean(string $body, ?string $apiKey): string
    {
        if (self::filled($apiKey)) {
            $body = str_replace(array_unique([(string) $apiKey, rawurlencode((string) $apiKey), urlencode((string) $apiKey)]), '[hidden]', $body);
        }
        $body = trim((string) preg_replace('/\s+/u', ' ', $body));

        return mb_strlen($body) > self::RESPONSE_MAX ? mb_substr($body, 0, self::RESPONSE_MAX - 1).'…' : $body;
    }

    private function result(SmsSettingsData $settings, string $host, Response $response): SmsResult
    {
        $status = $response->status();
        $raw = (string) $response->body();
        $body = self::clean($raw, $settings->apiKey);

        if ($response->successful()) {
            $expected = trim((string) $settings->successContains);
            if ($expected === '' || str_contains($raw, $expected)) {
                $this->log($host, $status, null);

                return SmsResult::sent($status, $body);
            }
            $this->log($host, $status, 'unexpected_response');

            return SmsResult::failed('unexpected_response', $status, $body);
        }

        $retryable = $status === 429 || $status >= 500;
        $error = $status >= 300 && $status < 400 ? 'redirect_refused' : 'http_'.$status;
        $this->log($host, $status, $error);

        return SmsResult::failed($error, $status, $body, $retryable);
    }

    private static function filled(?string $value): bool
    {
        return $value !== null && $value !== '';
    }

    private function log(string $host, ?int $status, ?string $error): void
    {
        $context = ['host' => $host, 'status' => $status, 'error' => $error];
        if ($error === null) {
            Log::channel('sms')->info('SMS gateway accepted a message', $context);
        } else {
            Log::channel('sms')->warning('SMS gateway error', $context);
        }
    }
}
