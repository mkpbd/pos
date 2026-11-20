<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;

/**
 * The current organization's storefront settings and theme. Organizations that never
 * saved them get defaults (a disabled store named after the organization, default theme)
 * as unsaved models, so readers never deal with missing rows.
 */
class StorefrontConfig
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    public function settings(): StorefrontSettings
    {
        return StorefrontSettings::query()->first() ?? new StorefrontSettings([
            'is_enabled' => false,
            'site_name' => $this->organizations->summary($this->tenant->requireOrganization())['name'] ?? '',
            'meta_description' => null,
        ]);
    }

    /**
     * Scheme and host of the organization's primary storefront domain (for links in e-mails
     * sent from staff actions), or null without a domain. The scheme follows `app.url`.
     */
    public function primaryUrl(): ?string
    {
        $host = StorefrontDomain::query()->orderByDesc('is_primary')->orderBy('host')->value('host');
        if (! is_string($host) || $host === '') {
            return null;
        }
        $scheme = parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https';

        return "{$scheme}://{$host}";
    }

    public function theme(): ThemeSettings
    {
        $theme = ThemeSettings::query()->first() ?? new ThemeSettings(['custom_css' => null]);
        $theme->settings = ThemeSchema::normalize($theme->settings ?? []);

        return $theme;
    }

    /**
     * AI2b: what the shop assistant may tell shoppers about the store itself — the return
     * window (days after delivery, 0 = no online returns), the contact details shown in the
     * store footer (theme) and whether a WhatsApp number is set. All public on the store.
     *
     * @return array{return_window_days: int, contact: array{email: ?string, phone: ?string, address: ?string}, whatsapp: bool}
     */
    public function shopperFacts(): array
    {
        $settings = $this->settings();
        $contact = $this->theme()->settings['footer']['contact'] ?? [];
        $text = fn (mixed $v) => is_string($v) && trim($v) !== '' ? trim($v) : null;

        return [
            'return_window_days' => (int) ($settings->return_window_days ?? 7),
            'contact' => ['email' => $text($contact['email'] ?? null), 'phone' => $text($contact['phone'] ?? null), 'address' => $text($contact['address'] ?? null)],
            'whatsapp' => is_string($settings->whatsapp_number) && $settings->whatsapp_number !== '',
        ];
    }
}
