<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Storefront\Domain\BannerPlacement;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property BannerPlacement $placement
 * @property string $name
 * @property ?string $kicker
 * @property ?string $title
 * @property ?string $subtitle
 * @property ?string $link_url
 * @property ?string $button_label
 * @property ?string $secondary_link_url
 * @property ?string $secondary_button_label
 * @property string $desktop_media_id
 * @property ?string $mobile_media_id
 * @property string $text_color
 * @property string $text_position
 * @property ?int $popup_delay_seconds
 * @property ?string $popup_frequency
 * @property ?CarbonImmutable $starts_at
 * @property ?CarbonImmutable $ends_at
 * @property bool $is_active
 * @property int $sort_order
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'placement', 'name', 'kicker', 'title', 'subtitle', 'link_url', 'button_label', 'secondary_link_url', 'secondary_button_label', 'desktop_media_id', 'mobile_media_id', 'text_color', 'text_position', 'popup_delay_seconds', 'popup_frequency', 'starts_at', 'ends_at', 'is_active', 'sort_order'])]
class Banner extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'text_color' => '#ffffff',
        'text_position' => 'left',
        'is_active' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'placement' => BannerPlacement::class,
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
            'popup_delay_seconds' => 'integer',
        ];
    }

    /**
     * Active banners whose schedule window includes now.
     *
     * @param  Builder<Banner>  $query
     */
    public function scopeLive(Builder $query): void
    {
        $now = now();
        $query->where('is_active', true)
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', $now));
    }

    /**
     * `live`, `inactive`, `scheduled` (window not started) or `ended`.
     */
    public function state(): string
    {
        $now = now();

        return match (true) {
            ! $this->is_active => 'inactive',
            $this->starts_at !== null && $this->starts_at->gt($now) => 'scheduled',
            $this->ends_at !== null && $this->ends_at->lte($now) => 'ended',
            default => 'live',
        };
    }

    public function isLive(): bool
    {
        $now = now();

        return $this->is_active && ($this->starts_at === null || $this->starts_at->lte($now)) && ($this->ends_at === null || $this->ends_at->gt($now));
    }
}
