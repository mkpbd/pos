<?php

namespace App\Modules\Orders\Tests\Fakes;

use App\Modules\Sms\Application\Contracts\SmsSender;
use RuntimeException;

/**
 * BD1a: an in-memory SmsSender for Orders / Storefront tests (no Sms module internals):
 * `ready` / `otpReady` per organization (default on), every orderEvent() call recorded,
 * `$throws` makes it fail like a broken SMS module.
 */
class FakeSmsSender implements SmsSender
{
    public bool $ready = true;

    public bool $otpReady = true;

    /** @var array<string, bool> organization id => ready (overrides /) */
    public array $readyFor = [];

    public bool $throws = false;

    /** @var list<array{org: string, event: string, phone: string, locale: string, vars: array<string, string|null>, order_id: string}> */
    public array $events = [];

    /** @var list<array{org: string, phone: string, purpose: string, text: string}> */
    public array $queued = [];

    public function ready(string $orgId): bool
    {
        return $this->readyFor[$orgId] ?? $this->ready;
    }

    public function otpReady(string $orgId): bool
    {
        return $this->readyFor[$orgId] ?? ($this->ready && $this->otpReady);
    }

    public function queue(string $orgId, string $phone, string $purpose, string $text, ?string $dedupeKey = null, ?string $relatedType = null, ?string $relatedId = null, ?string $maskedText = null): ?string
    {
        if ($this->throws) {
            throw new RuntimeException('SMS is broken');
        }
        $this->queued[] = ['org' => $orgId, 'phone' => $phone, 'purpose' => $purpose, 'text' => $text];

        return (string) count($this->queued);
    }

    public function orderEvent(string $orgId, string $event, string $phone, string $locale, array $vars, string $orderId): void
    {
        if ($this->throws) {
            throw new RuntimeException('SMS is broken');
        }
        $this->events[] = ['org' => $orgId, 'event' => $event, 'phone' => $phone, 'locale' => $locale, 'vars' => $vars, 'order_id' => $orderId];
    }

    /** @var array<string, bool> POS1d: event => enabled (default on) */
    public array $templates = [];

    public function templateEnabled(string $orgId, string $event): bool
    {
        return $this->templates[$event] ?? true;
    }

    public function renderTemplate(string $orgId, string $event, string $locale, array $vars): string
    {
        return trim($event.' '.$locale.' '.implode(' ', array_filter($vars, fn ($v) => $v !== null && $v !== '')));
    }

    public function messageStatus(string $orgId, string $messageId): ?string
    {
        return isset($this->queued[(int) $messageId - 1]) ? 'queued' : null;
    }

    /**
     * @return list<string>
     */
    public function eventNames(): array
    {
        return array_column($this->events, 'event');
    }
}
