<?php

namespace App\Modules\Social\Domain\Meta;

/**
 * P2b: what the Social module needs from Facebook and Instagram — Facebook Login (code →
 * long-lived user token → Pages with their Instagram business accounts) and publishing.
 * Implementations: HttpMetaGraphClient (Graph API over Laravel's HTTP client, no SDK) and
 * SandboxMetaGraphClient (no network, fake ids). Every failure is a MetaGraphError.
 */
interface MetaGraphClient
{
    /** Facebook Login permissions the connect flow asks for. */
    public const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];

    /**
     * The Facebook Login dialog address the browser is sent to.
     */
    public function loginUrl(MetaApp $app, string $redirectUri, string $state): string;

    /**
     * The (short-lived) user token for the code Facebook sent back to the redirect address.
     *
     * @throws MetaGraphError
     */
    public function exchangeCode(MetaApp $app, string $code, string $redirectUri): MetaToken;

    /**
     * A long-lived (about 60 days) user token for a short-lived one.
     *
     * @throws MetaGraphError
     */
    public function longLivedToken(MetaApp $app, MetaToken $token): MetaToken;

    /**
     * The Pages the user granted, with Page tokens and linked Instagram business accounts.
     *
     * @return list<MetaPage>
     *
     * @throws MetaGraphError
     */
    public function pages(MetaApp $app, MetaToken $userToken): array;

    /**
     * A Page post: one photo (`/{page}/photos`), several (unpublished photos + `/{page}/feed`
     * with `attached_media`) or none (a link / text post on `/{page}/feed`).
     *
     * @param  list<string>  $imageUrls  public https addresses
     *
     * @throws MetaGraphError
     */
    public function publishToFacebook(MetaApp $app, MetaPage $page, string $message, array $imageUrls, ?string $link): PublishedPost;

    /**
     * An Instagram post (`/{ig}/media` + `/{ig}/media_publish`; a carousel for several photos).
     *
     * @param  list<string>  $imageUrls  public https JPEG addresses (at least one)
     *
     * @throws MetaGraphError
     */
    public function publishToInstagram(MetaApp $app, MetaPage $page, string $caption, array $imageUrls): PublishedPost;
}
