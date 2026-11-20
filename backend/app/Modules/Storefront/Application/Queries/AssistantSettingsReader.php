<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Storefront\Application\Contracts\StoreAssistantSettings;

/**
 * AI2b: Storefront's StoreAssistantSettings — the current store's assistant settings with the
 * hand-off resolved to one that works.
 */
final class AssistantSettingsReader implements StoreAssistantSettings
{
    /** The CMS page the "contact" hand-off opens. */
    public const CONTACT_SLUG = 'contact';

    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly PageDirectory $pages,
    ) {}

    public function current(string $locale): array
    {
        $settings = $this->config->settings();
        $name = trim((string) $settings->assistant_name);
        $greeting = $settings->assistant_greeting;
        $greeting = Translations::value($settings->assistant_translations, 'greeting', $locale, $greeting);

        $handoff = $settings->assistantHandoffChoice();
        $url = null;
        if ($handoff === 'whatsapp') {
            if ($settings->whatsapp_number !== null) {
                $url = 'https://wa.me/'.$settings->whatsapp_number;
            } else {
                $handoff = 'contact';
            }
        }
        if ($handoff === 'contact') {
            $page = $this->pages->visibleBySlug(self::CONTACT_SLUG);
            $url = $page === null ? null : '/pages/'.$page['slug'];
            $handoff = $url === null ? 'none' : 'contact';
        }

        return [
            'enabled' => (bool) $settings->assistant_enabled,
            'name' => $name === '' ? self::DEFAULT_NAME : $name,
            'greeting' => is_string($greeting) && trim($greeting) !== '' ? $greeting : null,
            'daily_conversation_limit' => (int) ($settings->assistant_daily_limit ?? self::DEFAULT_DAILY_LIMIT),
            'handoff' => $handoff,
            'handoff_url' => $url,
            'store_name' => (string) $settings->site_name,
            'bangla_enabled' => (bool) $settings->bangla_enabled,
            'default_locale' => (string) ($settings->default_locale ?? LocaleContext::EN),
            'bangla_digits' => (bool) $settings->bangla_digits,
        ];
    }
}
