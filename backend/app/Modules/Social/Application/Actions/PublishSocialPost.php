<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Application\Services\PostMedia;
use App\Modules\Social\Domain\Caption;
use App\Modules\Social\Domain\Meta\MetaGraphClient;
use App\Modules\Social\Domain\Meta\MetaGraphClients;
use App\Modules\Social\Domain\Meta\MetaGraphError;
use App\Modules\Social\Domain\Meta\PublishedPost;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Domain\PublicUrl;
use App\Modules\Social\Domain\SocialMode;
use App\Modules\Social\Domain\TargetStatus;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use App\Modules\Social\Infrastructure\Models\SocialPostResult;
use App\Modules\Social\Infrastructure\Models\SocialSettings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * P2b: publishes the pending targets of a `publishing` post (run by PublishSocialPostJob inside
 * the post's tenant). Each target is claimed with a conditional update (`pending` → `publishing`),
 * so two workers never post the same target; the caption gets the target's short link
 * (Caption::withLink; a Facebook post without photos is a link post instead). The outcome —
 * the network's id and permalink, or a plain error — is stored per target, then the post's status
 * follows from its targets (published, partially_published, failed).
 */
class PublishSocialPost
{
    public function __construct(
        private readonly SocialConfig $config,
        private readonly MetaGraphClients $clients,
        private readonly PostMedia $media,
        private readonly MarketingLinks $marketing,
    ) {}

    public function __invoke(string $postId): void
    {
        $post = SocialPost::query()->with('results')->find($postId);
        if ($post === null || $post->status !== PostStatus::Publishing) {
            return;
        }
        $settings = $this->config->settings();
        $account = $this->config->usableAccount($settings);
        $client = $this->clients->for($settings->mode);

        foreach ($post->results as $result) {
            if ($result->status !== TargetStatus::Pending) {
                continue;
            }
            $claimed = SocialPostResult::query()->whereKey($result->id)->where('status', TargetStatus::Pending->value)->update([
                'status' => TargetStatus::Publishing->value,
                'claimed_at' => now(),
                'attempts' => DB::raw('attempts + 1'),
                'updated_at' => now(),
            ]);
            if ($claimed !== 1) {
                continue;
            }

            try {
                $published = $this->publishTarget($post, $result, $settings, $account, $client);
                SocialPostResult::query()->whereKey($result->id)->update([
                    'status' => TargetStatus::Published->value,
                    'remote_id' => mb_substr($published->remoteId, 0, 100),
                    'permalink' => $published->permalink === null ? null : mb_substr($published->permalink, 0, 1000),
                    'error_code' => null,
                    'error_message' => null,
                    'sandbox' => $settings->mode === SocialMode::Sandbox,
                    'published_at' => now(),
                    'updated_at' => now(),
                ]);
            } catch (MetaGraphError $e) {
                $this->fail($result, $e->errorCode, $e->getMessage());
            } catch (Throwable $e) {
                // Only the class: exception messages of HTTP clients may contain addresses with tokens.
                Log::error('Social post publishing failed', ['post' => $post->id, 'target' => $result->target->value, 'exception' => $e::class]);
                $this->fail($result, MetaGraphError::GRAPH_ERROR, 'Something went wrong while publishing. Try again.');
            }
        }

        SocialPostWorkflow::finish($post->id);
    }

    private function publishTarget(SocialPost $post, SocialPostResult $result, SocialSettings $settings, ?SocialAccount $account, MetaGraphClient $client): PublishedPost
    {
        if ($account === null) {
            throw new MetaGraphError('NOT_CONNECTED', 'Facebook is not connected. Connect a Facebook Page (Marketing → Social) and retry.');
        }
        $urls = array_map(fn (array $file) => $this->config->absolute($file['url']), $this->media->forPost($post));
        if ($settings->mode === SocialMode::Live) {
            foreach ($urls as $url) {
                if (! PublicUrl::isPublicHttps($url)) {
                    throw new MetaGraphError('MEDIA_NOT_PUBLIC', 'Facebook and Instagram download the photos from your store, so they must be at a public https:// address.');
                }
            }
        }
        $link = $result->short_link_id === null ? null : ($this->marketing->shortLinks([$result->short_link_id])[$result->short_link_id]['url'] ?? null);
        $app = $settings->metaApp();
        $page = $account->page();

        if ($result->target === PostTarget::Instagram) {
            if ($page->instagram === null) {
                throw new MetaGraphError('NOT_CONNECTED', 'The connected Facebook Page has no Instagram business account.');
            }

            return $client->publishToInstagram($app, $page, Caption::withLink($post->caption, $link, PostTarget::Instagram), $urls);
        }

        // Facebook: with photos the link goes into the text; without, it becomes a link post.
        return $urls === []
            ? $client->publishToFacebook($app, $page, $post->caption, [], $link)
            : $client->publishToFacebook($app, $page, Caption::withLink($post->caption, $link, PostTarget::Facebook), $urls, null);
    }

    private function fail(SocialPostResult $result, string $code, string $message): void
    {
        SocialPostResult::query()->whereKey($result->id)->update([
            'status' => TargetStatus::Failed->value,
            'error_code' => mb_substr($code, 0, 50),
            'error_message' => MetaGraphError::scrub($message),
            'updated_at' => now(),
        ]);
    }
}
