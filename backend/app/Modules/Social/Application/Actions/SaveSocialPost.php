<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Social\Application\Services\PostMedia;
use App\Modules\Social\Application\Services\PublishReadiness;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Domain\TargetStatus;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use App\Modules\Social\Infrastructure\Models\SocialPostResult;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P2b: creating and changing social posts. A post without `scheduled_at` is a draft; with one
 * (in the future, at most a year ahead) it is scheduled — and must then be publishable
 * (PublishReadiness). Photos, product, campaign and link are checked against the organization
 * (field errors). Without a link, a product post links to the product's page. Only draft,
 * scheduled and failed posts change (INVALID_STATUS_TRANSITION); a changed failed post starts
 * over as a draft or scheduled post. Each target gets a pending result row.
 */
class SaveSocialPost
{
    public const MAX_SCHEDULE_DAYS = 365;

    public function __construct(
        private readonly PostMedia $media,
        private readonly ProductDirectory $products,
        private readonly StorefrontCatalog $catalog,
        private readonly MarketingLinks $marketing,
        private readonly PublishReadiness $readiness,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated
     */
    public function create(array $data): SocialPost
    {
        return DB::transaction(function () use ($data) {
            $post = new SocialPost(['status' => PostStatus::Draft]);
            $this->apply($post, $data + ['image_ids' => [], 'media_ids' => [], 'link_url' => null, 'product_id' => null, 'campaign_id' => null, 'scheduled_at' => null]);
            $post->save();
            $this->syncResults($post);

            return $post->fresh(['results']) ?? $post;
        });
    }

    /**
     * @param  array<string, mixed>  $data  validated (any subset)
     */
    public function update(SocialPost $post, array $data): SocialPost
    {
        return DB::transaction(function () use ($post, $data) {
            /** @var SocialPost $locked */
            $locked = SocialPost::query()->whereKey($post->id)->lockForUpdate()->firstOrFail();
            if (! $locked->status->editable()) {
                throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "A {$locked->status->value} post cannot be changed.", ['status' => $locked->status->value]);
            }
            if (! array_key_exists('scheduled_at', $data) && $locked->status === PostStatus::Failed) {
                // A failed post starts over: a draft unless a new time is given.
                $data['scheduled_at'] = null;
            }
            $this->apply($locked, $data);
            $locked->save();
            $this->syncResults($locked);

            return $locked->fresh(['results']) ?? $locked;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function apply(SocialPost $post, array $data): void
    {
        $errors = [];
        if (array_key_exists('caption', $data)) {
            $post->caption = trim((string) $data['caption']);
        }
        if (array_key_exists('targets', $data)) {
            $post->targets = array_values(array_unique(array_map('strval', (array) $data['targets'])));
        }

        if (array_key_exists('image_ids', $data) || array_key_exists('media_ids', $data)) {
            $imageIds = array_key_exists('image_ids', $data) ? $this->ids($data['image_ids']) : $post->mediaIds(SocialPost::KIND_PRODUCT_IMAGE);
            $mediaIds = array_key_exists('media_ids', $data) ? $this->ids($data['media_ids']) : $post->mediaIds(SocialPost::KIND_MEDIA);
            $images = $this->media->productImages($imageIds);
            $items = $this->media->mediaItems($mediaIds);
            if (count($images) !== count($imageIds)) {
                $errors['image_ids'] = ['Choose photos of your products.'];
            }
            if (count($items) !== count($mediaIds)) {
                $errors['media_ids'] = ['Choose photos from your media library.'];
            }
            if (count($imageIds) + count($mediaIds) > SocialPost::MAX_MEDIA) {
                $errors[array_key_exists('media_ids', $data) && $mediaIds !== [] ? 'media_ids' : 'image_ids'] = ['A post can have at most '.SocialPost::MAX_MEDIA.' photos.'];
            }
            $post->media = [
                ...array_map(fn (string $id) => ['kind' => SocialPost::KIND_PRODUCT_IMAGE, 'id' => $id], $imageIds),
                ...array_map(fn (string $id) => ['kind' => SocialPost::KIND_MEDIA, 'id' => $id], $mediaIds),
            ];
        }

        if (array_key_exists('product_id', $data)) {
            $productId = $data['product_id'] === null ? null : strtolower((string) $data['product_id']);
            if ($productId !== null && $this->products->products($this->tenant->requireOrganization(), [$productId]) === []) {
                $errors['product_id'] = ['Choose one of your products.'];
            }
            $post->product_id = $productId;
        }
        if (array_key_exists('campaign_id', $data)) {
            $campaignId = $data['campaign_id'] === null ? null : strtolower((string) $data['campaign_id']);
            if ($campaignId !== null && $this->marketing->campaigns([$campaignId]) === []) {
                $errors['campaign_id'] = ['Choose one of your campaigns.'];
            }
            $post->campaign_id = $campaignId;
        }
        if (array_key_exists('link_url', $data)) {
            $link = is_string($data['link_url']) ? trim($data['link_url']) : null;
            if ($link !== null && $link !== '' && ! $this->marketing->isStorePath($link)) {
                $errors['link_url'] = ['Enter a path of your store, such as /p/eid-sale or /product/my-product.'];
            }
            $post->link_path = $link === '' ? null : $link;
        }
        // Without a link, a product post links to the product's page (while it is on sale online).
        if ($post->link_path === null && $post->product_id !== null && (array_key_exists('link_url', $data) || array_key_exists('product_id', $data))) {
            $slug = $this->catalog->productSummaries([$post->product_id])[$post->product_id]['slug'] ?? null;
            $post->link_path = is_string($slug) ? '/product/'.$slug : null;
        }

        if (array_key_exists('scheduled_at', $data)) {
            $at = $data['scheduled_at'] === null ? null : CarbonImmutable::parse((string) $data['scheduled_at']);
            if ($at !== null && $at->lte(CarbonImmutable::now())) {
                $errors['scheduled_at'] = ['Choose a time in the future.'];
            } elseif ($at !== null && $at->gt(CarbonImmutable::now()->addDays(self::MAX_SCHEDULE_DAYS))) {
                $errors['scheduled_at'] = ['Choose a time within a year.'];
            }
            $post->scheduled_at = $at;
            $post->status = $at === null ? PostStatus::Draft : PostStatus::Scheduled;
        } elseif ($post->status === PostStatus::Scheduled && $post->scheduled_at !== null && $post->scheduled_at->lte(CarbonImmutable::now())) {
            $errors['scheduled_at'] = ['Choose a time in the future.'];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        if ($post->status === PostStatus::Scheduled) {
            $this->readiness->check($post, $post->targetList());
        }
    }

    /**
     * One pending result row per target (rows of removed targets deleted, the others reset).
     */
    private function syncResults(SocialPost $post): void
    {
        $targets = array_map(fn (PostTarget $t) => $t->value, $post->targetList());
        SocialPostResult::query()->where('post_id', $post->id)->whereNotIn('target', $targets)->delete();
        foreach ($post->targetList() as $target) {
            $result = SocialPostResult::query()->where('post_id', $post->id)->where('target', $target->value)->first()
                ?? new SocialPostResult(['post_id' => $post->id, 'target' => $target]);
            $result->fill([
                'status' => TargetStatus::Pending,
                'remote_id' => null,
                'permalink' => null,
                'error_code' => null,
                'error_message' => null,
                'claimed_at' => null,
                'published_at' => null,
                'sandbox' => false,
                // The link may have changed: a fresh short link is made when it is published.
                'short_link_id' => null,
            ]);
            $result->save();
        }
    }

    /**
     * @return list<string>
     */
    private function ids(mixed $ids): array
    {
        return array_values(array_unique(array_map(fn ($id) => strtolower((string) $id), is_array($ids) ? $ids : [])));
    }
}
