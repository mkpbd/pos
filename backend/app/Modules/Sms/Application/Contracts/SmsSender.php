<?php

namespace App\Modules\Sms\Application\Contracts;

/**
 * BD1a: queues text messages through the organization's SMS gateway (Sms module).
 * Used by Orders (order event messages) and by PhoneVerification (sign-in / checkout codes).
 * Every method is tenant-explicit: the organization id is always passed in.
 */
interface SmsSender
{
    /** Order events with a message template (also the `sms_messages.purpose` used for them). */
    public const ORDER_EVENTS = ['order_placed', 'order_confirmed', 'order_shipped', 'order_delivered', 'order_cancelled'];

    /** SMS is switched on and the gateway is configured (driver `log`, or `http` with a URL). */
    public function ready(string $orgId): bool;

    /** ready() and able to deliver one-time codes (the `log` driver cannot in production). */
    public function otpReady(string $orgId): bool;

    /**
     * Stores the message as `queued` and dispatches the send job after commit; returns the
     * message id. Returns null (nothing stored) for an invalid phone, a duplicate dedupe key or
     * when SMS is not ready. Over the monthly limit the row is stored as `skipped`.
     * $maskedText (e.g. the code replaced by ••••••) is what gets stored instead of $text.
     */
    public function queue(
        string $orgId,
        string $phone,
        string $purpose,
        string $text,
        ?string $dedupeKey = null,
        ?string $relatedType = null,
        ?string $relatedId = null,
        ?string $maskedText = null,
    ): ?string;

    /**
     * Renders and queues the template of an order event (one of ORDER_EVENTS) unless the
     * template is switched off. Vars: name, order, total, link, courier, tracking, tracking_link
     * ({shop} defaults to the storefront / organization name). Deduplicated per order + event.
     *
     * @param  array<string, string|null>  $vars
     */
    public function orderEvent(string $orgId, string $event, string $phone, string $locale, array $vars, string $orderId): void;
}
