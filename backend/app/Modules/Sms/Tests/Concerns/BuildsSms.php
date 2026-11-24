<?php

namespace App\Modules\Sms\Tests\Concerns;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Infrastructure\Gateways\HostResolver;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;

/**
 * BD1a: SMS tests — a fake DNS (public address unless a host is listed in $dns), the `sms` log
 * channel silenced but captured (every log line, any channel, lands in $logged), and helpers
 * to switch an organization's SMS on. Use with InteractsWithTenancy.
 */
trait BuildsSms
{
    use InteractsWithTenancy;

    /** @var array<string, list<string>> host => addresses the fake resolver answers */
    public array $dns = [];

    /** @var list<array{message: string, context: array<string, mixed>}> */
    protected array $logged = [];

    protected function setUpSms(): void
    {
        config(['logging.channels.sms' => config('logging.channels.null')]);
        $this->app->instance(HostResolver::class, new class($this) implements HostResolver
        {
            public function __construct(private readonly object $test) {}

            public function resolve(string $host): array
            {
                return $this->test->dns[$host] ?? ['93.184.216.34'];
            }
        });
        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $this->logged[] = ['message' => $e->message, 'context' => $e->context];
        });
    }

    /**
     * Switches SMS on for the signed-in admin's organization (test mode unless $settings say otherwise).
     *
     * @param  array<string, mixed>  $settings
     */
    protected function enableSms(array $settings = []): void
    {
        $this->patchJson('/api/v1/sms/settings', $settings + ['is_enabled' => true, 'driver' => 'log'])->assertOk();
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    protected function enableHttpSms(array $settings = []): void
    {
        $this->enableSms($settings + [
            'driver' => 'http',
            'http_url' => 'https://sms.example.com/api/send',
            'http_method' => 'POST',
            'http_body' => 'form',
            'param_api_key' => 'api_key',
            'api_key' => 'KEY-SECRET-123456',
            'param_sender' => 'senderid',
            'sender_id' => 'BERRYKIDS',
        ]);
    }

    /** The text of the last message written by the test-mode gateway. */
    protected function lastLoggedText(): ?string
    {
        foreach (array_reverse($this->logged) as $line) {
            if ($line['message'] === 'SMS (test mode, not sent)') {
                return $line['context']['text'] ?? null;
            }
        }

        return null;
    }

    /** The one-time code in the last test-mode message. */
    protected function lastCode(): ?string
    {
        return preg_match('/\b(\d{6})\b/', (string) $this->lastLoggedText(), $m) === 1 ? $m[1] : null;
    }

    protected function allLogs(): string
    {
        return json_encode($this->logged, JSON_UNESCAPED_UNICODE) ?: '';
    }
}
