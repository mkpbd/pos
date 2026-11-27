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

    /** POS1d: the digital receipt of a till sale (template event and `sms_messages.purpose`). */
    public const SALE_RECEIPT = 'sale_receipt';

    /** R1: a customer's due (বাকি) reminder (template event and `sms_messages.purpose`). */
    public const DUE_REMINDER = 'due_reminder';

    /** BD2b: an abandoned-cart reminder to a signed-in shopper (template event and `sms_messages.purpose`). */
    public const CART_REMINDER = 'cart_reminder';

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

    /** POS1d: whether the message template of an event (ORDER_EVENTS or SALE_RECEIPT) is switched on. */
    public function templateEnabled(string $orgId, string $event): bool;

    /**
     * POS1d: the text of an event's template (ORDER_EVENTS or SALE_RECEIPT) in $locale (`bn` or
     * `en`) with $vars filled in ({shop} defaults to the storefront / organization name).
     *
     * @param  array<string, string|null>  $vars
     */
    public function renderTemplate(string $orgId, string $event, string $locale, array $vars): string;

    /** POS1d: the status of a message queue() returned (queued | sent | failed | skipped), null when unknown. */
    public function messageStatus(string $orgId, string $messageId): ?string;
}
