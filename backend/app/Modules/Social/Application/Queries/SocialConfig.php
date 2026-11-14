<?php

namespace App\Modules\Social\Application\Queries;

use App\Modules\Social\Domain\SocialMode;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use App\Modules\Social\Infrastructure\Models\SocialSettings;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * P2b: the current organization's social settings (defaults — sandbox, no Meta app — as an
 * unsaved model when never saved), its connected account and the addresses the flows use.
 */
class SocialConfig
{
    public const CALLBACK_PATH = '/api/v1/social/meta/callback';

    public const ADMIN_PATH = '/admin/marketing/social';

    public function __construct(private readonly StorefrontConfig $storefront) {}

    public function settings(): SocialSettings
    {
        return SocialSettings::query()->first() ?? new SocialSettings(['mode' => SocialMode::Sandbox, 'graph_version' => SocialSettings::DEFAULT_GRAPH_VERSION]);
    }

    /**
     * The connected account, or null.
     */
    public function account(): ?SocialAccount
    {
        return SocialAccount::query()->first();
    }

    /**
     * The connected account when it belongs to the current mode (a sandbox "Demo Page" never
     * publishes live and the other way round), else null.
     */
    public function usableAccount(SocialSettings $settings): ?SocialAccount
    {
        $account = $this->account();

        return $account !== null && $account->sandbox === ($settings->mode === SocialMode::Sandbox) ? $account : null;
    }

    /**
     * The OAuth redirect address to register in the Meta app (Facebook Login → Valid OAuth
     * Redirect URIs): the application's own address (APP_URL).
     */
    public function redirectUri(): string
    {
        return rtrim((string) config('app.url'), '/').self::CALLBACK_PATH;
    }

    /**
     * Where the browser returns after connecting: the admin's Social page with `?connected=1` or
     * `?error=<code>`.
     *
     * @param  array<string, string>  $query
     */
    public static function adminUrl(array $query): string
    {
        return self::ADMIN_PATH.'?'.http_build_query($query);
    }

    /**
     * Scheme and host shoppers (and Facebook) reach the store at: the primary store domain, else
     * the application's address.
     */
    public function siteUrl(): string
    {
        return $this->storefront->primaryUrl() ?? rtrim((string) config('app.url'), '/');
    }

    /**
     * An absolute address for a site-relative one (`/storage/…`).
     */
    public function absolute(string $url): string
    {
        return preg_match('#^https?://#i', $url) === 1 ? $url : $this->siteUrl().'/'.ltrim($url, '/');
    }
}
