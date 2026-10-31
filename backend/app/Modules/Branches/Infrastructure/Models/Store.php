<?php

namespace App\Modules\Branches\Infrastructure\Models;

use App\Modules\Branches\Domain\StoreType;
use App\Modules\Branches\Infrastructure\Database\Factories\StoreFactory;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A stock location of a branch (sales floor or warehouse).
 *
 * @property string $id
 * @property string $branch_id
 * @property string $code
 * @property string $name
 * @property StoreType $type
 * @property bool $is_active
 */
#[UseFactory(StoreFactory::class)]
#[Fillable(['organization_id', 'branch_id', 'code', 'name', 'type', 'is_active'])]
class Store extends Model
{
    /** @use HasFactory<StoreFactory> */
    use BelongsToOrganization, HasFactory, HasUuids, TracksAuthor;

    protected $attributes = [
        'type' => 'store',
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'type' => StoreType::class,
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Branch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
