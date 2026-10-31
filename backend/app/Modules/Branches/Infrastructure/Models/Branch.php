<?php

namespace App\Modules\Branches\Infrastructure\Models;

use App\Modules\Branches\Infrastructure\Database\Factories\BranchFactory;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $code
 * @property string $name
 * @property bool $is_active
 * @property bool $allow_negative_stock
 * @property ?string $timezone
 * @property array<string, mixed> $settings
 */
#[UseFactory(BranchFactory::class)]
#[Fillable([
    'organization_id', 'code', 'name', 'email', 'phone', 'address', 'timezone',
    'is_active', 'allow_negative_stock', 'settings',
])]
class Branch extends Model
{
    /** @use HasFactory<BranchFactory> */
    use BelongsToOrganization, HasFactory, HasUuids, TracksAuthor;

    protected $attributes = [
        'settings' => '{}',
        'is_active' => true,
        'allow_negative_stock' => false,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'allow_negative_stock' => 'boolean',
            'settings' => 'array',
        ];
    }

    /**
     * @return HasMany<Store, $this>
     */
    public function stores(): HasMany
    {
        return $this->hasMany(Store::class);
    }
}
