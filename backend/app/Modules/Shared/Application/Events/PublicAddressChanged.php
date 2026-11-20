<?php

namespace App\Modules\Shared\Application\Events;

/**
 * B16: a public storefront address of a record changed or was taken — a content page
 * (`/pages/<slug>`), a blog post (`/blog/<slug>`), a product, category or brand
 * (`/product|category|brand/<slug>`) or a landing page (`/p/<slug>`). Dispatched synchronously
 * inside the owning module's transaction; the Storefront module turns it into an automatic 301
 * from the old address to the new one (collapsing chains) and drops redirects from the new
 * address, which is live again.
 *
 * `$from` null: the record is new (only `$to` became an address). `$to` null: nothing took
 * an address (not used yet).
 */
final readonly class PublicAddressChanged
{
    public function __construct(
        public string $organizationId,
        public ?string $from,
        public ?string $to,
    ) {}

    /**
     * Dispatches the event when the address changed (`$oldSlug` null: a new record).
     */
    public static function dispatchFor(string $organizationId, string $prefix, ?string $oldSlug, ?string $newSlug): void
    {
        if ($newSlug === null || $newSlug === '' || $oldSlug === $newSlug) {
            return;
        }
        event(new self($organizationId, $oldSlug === null || $oldSlug === '' ? null : $prefix.$oldSlug, $prefix.$newSlug));
    }
}
