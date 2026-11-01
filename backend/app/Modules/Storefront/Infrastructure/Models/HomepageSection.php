<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Storefront\Domain\SectionType;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $organization_id
 * @property SectionType $type
 * @property ?string $title
 * @property ?string $subtitle
 * @property array<string, mixed> $config
 * @property bool $is_enabled
 * @property ?CarbonImmutable $starts_at
 * @property ?CarbonImmutable $ends_at
 * @property int $sort_order
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'type', 'title', 'subtitle', 'config', 'is_enabled', 'starts_at', 'ends_at', 'sort_order'])]
class HomepageSection extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = [
        'config' => '{}',
        'is_enabled' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'type' => SectionType::class,
            'config' => 'array',
            'is_enabled' => 'boolean',
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'sort_order' => 'integer',
        ];
    }

    /**
     * @return HasMany<HomepageSectionItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(HomepageSectionItem::class, 'section_id')->orderBy('sort_order');
    }

    /**
     * `live`, `disabled`, `scheduled` (window not started) or `expired` (window over).
     */
    public function scheduleState(): string
    {
        $now = now();

        return match (true) {
            ! $this->is_enabled => 'disabled',
            $this->starts_at !== null && $this->starts_at->gt($now) => 'scheduled',
            $this->ends_at !== null && $this->ends_at->lte($now) => 'expired',
            default => 'live',
        };
    }
}
