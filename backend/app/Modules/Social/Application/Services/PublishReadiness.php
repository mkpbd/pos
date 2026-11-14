<?php

namespace App\Modules\Social\Application\Services;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Domain\Caption;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Domain\PublicUrl;
use App\Modules\Social\Domain\SocialMode;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use Illuminate\Validation\ValidationException;

/**
 * P2b: whether a post can go out to these targets now (when it is scheduled, published or
 * retried): a connected account of the current mode (SOCIAL_NOT_CONNECTED), for Instagram a
 * linked Instagram account (INSTAGRAM_NOT_CONNECTED), at least one photo
 * (INSTAGRAM_IMAGE_REQUIRED) and at most 30 hashtags (INSTAGRAM_TOO_MANY_HASHTAGS); photos that
 * still exist (field errors); live only: photos at public https:// addresses (MEDIA_NOT_PUBLIC)
 * and JPEG photos for Instagram (INSTAGRAM_JPEG_ONLY).
 */
class PublishReadiness
{
    public function __construct(
        private readonly SocialConfig $config,
        private readonly PostMedia $media,
    ) {}

    /**
     * @param  list<PostTarget>  $targets
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function check(SocialPost $post, array $targets): void
    {
        $settings = $this->config->settings();
        $account = $this->config->usableAccount($settings);
        if ($account === null) {
            throw new BusinessRuleViolation('SOCIAL_NOT_CONNECTED', 'Connect a Facebook Page first (Marketing → Social).');
        }

        $files = $this->media->forPost($post);
        if (count($files) < count($post->media)) {
            $kind = collect($post->media)->first(fn (array $m) => ! in_array($m['id'], array_column($files, 'id'), true))['kind'] ?? SocialPost::KIND_MEDIA;
            throw ValidationException::withMessages([
                ($kind === SocialPost::KIND_PRODUCT_IMAGE ? 'image_ids' : 'media_ids') => ['A photo of this post was deleted. Choose the photos again.'],
            ]);
        }

        $instagram = in_array(PostTarget::Instagram, $targets, true);
        if ($instagram) {
            if ($account->instagram_id === null) {
                throw new BusinessRuleViolation('INSTAGRAM_NOT_CONNECTED', 'The connected Facebook Page has no Instagram business account. Link one to the Page in Meta Business Suite, then connect again.');
            }
            if ($files === []) {
                throw new BusinessRuleViolation('INSTAGRAM_IMAGE_REQUIRED', 'Instagram posts need at least one photo.');
            }
            if (Caption::hashtagCount($post->caption) > Caption::MAX_HASHTAGS) {
                throw new BusinessRuleViolation('INSTAGRAM_TOO_MANY_HASHTAGS', 'Instagram allows at most '.Caption::MAX_HASHTAGS.' hashtags in a caption.', ['max' => Caption::MAX_HASHTAGS]);
            }
        }

        if ($settings->mode === SocialMode::Live) {
            foreach ($files as $file) {
                if (! PublicUrl::isPublicHttps($this->config->absolute($file['url']))) {
                    throw new BusinessRuleViolation('MEDIA_NOT_PUBLIC', 'Facebook and Instagram download the photos from your store, so they must be at a public https:// address. Post from your live store (with its own domain and https).', [
                        'url' => $this->config->absolute($file['url']),
                    ]);
                }
                if ($instagram && $file['mime_type'] !== 'image/jpeg') {
                    throw new BusinessRuleViolation('INSTAGRAM_JPEG_ONLY', 'Instagram accepts JPEG photos only. Choose JPEG photos or post to Facebook only.', ['id' => $file['id']]);
                }
            }
        }
    }
}
