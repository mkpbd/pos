<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Inventory\Domain\StocktakeScope;
use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Domain\UncountedPolicy;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * ST1: a stocktake (physical count) of one store.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property string $number
 * @property StocktakeStatus $status
 * @property StocktakeScope $scope
 * @property ?list<string> $scope_ids
 * @property bool $blind
 * @property ?string $notes
 * @property ?Carbon $started_at
 * @property ?UncountedPolicy $uncounted_policy
 * @property ?Carbon $posted_at
 * @property ?string $posted_by
 * @property ?string $adjustment_id
 * @property ?Carbon $cancelled_at
 * @property ?string $cancelled_by
 * @property ?string $created_by
 * @property ?Carbon $created_at
 */
#[Fillable(['organization_id', 'branch_id', 'store_id', 'number', 'status', 'scope', 'scope_ids', 'blind', 'notes', 'started_at', 'uncounted_policy', 'posted_at', 'posted_by', 'adjustment_id', 'cancelled_at', 'cancelled_by', 'created_by'])]
class Stocktake extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => StocktakeStatus::class,
            'scope' => StocktakeScope::class,
            'scope_ids' => 'array',
            'blind' => 'boolean',
            'started_at' => 'datetime',
            'uncounted_policy' => UncountedPolicy::class,
            'posted_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<StocktakeLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(StocktakeLine::class);
    }
}
