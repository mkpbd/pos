<?php

namespace App\Modules\Social\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Domain\PostTarget;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * P2b: a Facebook / Instagram post — caption, targets, photos (product photos and media library
 * items, in order), the store path it links to, the product and campaign it is about, its status
 * and schedule. Each target's outcome is a SocialPostResult.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $caption
 * @property list<string> $targets
 * @property list<array{kind: string, id: string}> $media
 * @property ?string $link_path
 * @property ?string $product_id
 * @property ?string $campaign_id
 * @property PostStatus $status
 * @property ?CarbonImmutable $scheduled_at
 * @property ?CarbonImmutable $publishing_started_at
 * @property ?CarbonImmutable $published_at
 * @property ?string $created_by
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 * @property-read Collection<int, SocialPostResult> $results
 */
#[Fillable(['organization_id', 'caption', 'targets', 'media', 'link_path', 'product_id', 'campaign_id', 'status', 'scheduled_at', 'publishing_started_at', 'published_at'])]
class SocialPost extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const KIND_PRODUCT_IMAGE = 'product_image';

    public const KIND_MEDIA = 'media';

    public const MAX_MEDIA = 10;

    protected $attributes = [
        'status' => 'draft',
        'targets' => '[]',
        'media' => '[]',
    ];

    protected function casts(): array
    {
        return [
            'targets' => 'array',
            'media' => 'array',
            'status' => PostStatus::class,
            'scheduled_at' => 'immutable_datetime',
            'publishing_started_at' => 'immutable_datetime',
            'published_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<SocialPostResult, $this>
     */
    public function results(): HasMany
    {
        return $this->hasMany(SocialPostResult::class, 'post_id');
    }

    /**
     * @return list<PostTarget>
     */
    public function targetList(): array
    {
        return array_values(array_filter(array_map(fn ($t) => is_string($t) ? PostTarget::tryFrom($t) : null, $this->targets)));
    }

    /**
     * Ids of the photos of one kind, in order.
     *
     * @return list<string>
     */
    public function mediaIds(string $kind): array
    {
        return array_values(array_map(fn (array $m) => (string) $m['id'], array_filter($this->media, fn ($m) => is_array($m) && ($m['kind'] ?? null) === $kind)));
    }
}
