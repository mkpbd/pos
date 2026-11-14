<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Social\Application\Actions\ManageProductFeeds;
use App\Modules\Social\Domain\FeedChannel;
use App\Modules\Social\Infrastructure\Models\ProductFeed;
use App\Modules\Social\Presentation\Http\Support\SocialPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * P2b: Marketing → Product feeds (Meta, TikTok, Pinterest catalogs).
 */
class ProductFeedController
{
    public function __construct(
        private readonly ManageProductFeeds $feeds,
        private readonly SocialPresenter $presenter,
    ) {}

    /**
     * Product feeds
     *
     * Always the three channels in order: `[{channel: meta|tiktok|pinterest, enabled, xml_url,
     * csv_url, item_count|null, last_generated_at|null, updated_at}]`. The URLs are secret (their
     * token is the only key); `?lang=bn` gives the Bangla feed while Bangla is on.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(array_map(fn (ProductFeed $f) => $this->presenter->feed($f), $this->feeds->all()));
    }

    /**
     * Enable or disable a feed
     *
     * `{enabled: bool}`. Enabling generates the feed once (item count, time). A disabled feed's
     * URLs answer 404. Audited.
     */
    public function update(Request $request, string $channel): JsonResponse
    {
        $data = $request->validate(['enabled' => ['required', 'boolean']]);

        return ApiResponse::success($this->presenter->feed($this->feeds->setEnabled($this->channel($channel), (bool) $data['enabled'])));
    }

    /**
     * New feed URLs
     *
     * A new token: the old URLs answer 404 at once (paste the new ones into the catalog). Audited.
     */
    public function rotate(string $channel): JsonResponse
    {
        return ApiResponse::success($this->presenter->feed($this->feeds->rotate($this->channel($channel))));
    }

    private function channel(string $channel): FeedChannel
    {
        return FeedChannel::tryFrom($channel) ?? abort(404);
    }
}
