<?php

namespace App\Modules\Storefront\Application\Contracts;

/**
 * AI2b: the current store's (storefront host / tenant) shopper assistant settings, effective
 * values — for the AI module's shopper assistant and the bootstrap.
 *
 * - `enabled`: the store's switch only (whether AI is available is the AI module's business);
 * - `name`: never blank ("Shop assistant" by default); `greeting` in the given language (Bangla
 *   falls back to English), null when unset;
 * - `handoff`: `whatsapp` (a WhatsApp number is set) | `contact` (a visible CMS page with the
 *   slug `contact` exists) | `none` — a choice that cannot work falls back (WhatsApp without a
 *   number → contact; contact without the page → none); `handoff_url` `https://wa.me/<digits>`,
 *   `/pages/contact` or null.
 */
interface StoreAssistantSettings
{
    public const DEFAULT_NAME = 'Shop assistant';

    public const DEFAULT_DAILY_LIMIT = 200;

    public const HANDOFFS = ['whatsapp', 'contact', 'none'];

    /**
     * @return array{enabled: bool, name: string, greeting: ?string, daily_conversation_limit: int, handoff: 'whatsapp'|'contact'|'none', handoff_url: ?string, store_name: string, bangla_enabled: bool, default_locale: string, bangla_digits: bool}
     */
    public function current(string $locale): array;
}
