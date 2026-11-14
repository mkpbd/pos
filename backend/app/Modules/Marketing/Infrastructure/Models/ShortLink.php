<?php

namespace App\Modules\Marketing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * P2a: a short link `https://<store host>/go/<code>` that sends visitors to a store path with
 * UTM parameters (for social posts and ads) and counts the clicks.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $code
 * @property string $target_path
 * @property ?string $campaign_id
 * @property ?string $utm_source
 * @property ?string $utm_medium
 * @property ?string $utm_campaign
 * @property ?string $utm_content
 * @property ?string $utm_term
 * @property int $clicks
 * @property ?CarbonImmutable $last_clicked_at
 * @property bool $active
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 * @property-read ?Campaign $campaign
 */
#[Fillable([
    'organization_id', 'code', 'target_path', 'campaign_id', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'clicks', 'last_clicked_at', 'active',
])]
class ShortLink extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const UTM = ['source', 'medium', 'campaign', 'content', 'term'];

    protected $attributes = [
        'clicks' => 0,
        'active' => true,
    ];

    protected function casts(): array
    {
        return [
            'clicks' => 'integer',
            'active' => 'boolean',
            'last_clicked_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Campaign, $this>
     */
    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class);
    }
}
