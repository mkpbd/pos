<?php

namespace App\Modules\Payments\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A till of a branch: a cash drawer that one cashier at a time runs a session on.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $code
 * @property string $name
 * @property bool $is_active
 */
#[Fillable(['organization_id', 'branch_id', 'code', 'name', 'is_active'])]
class CashRegister extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return HasMany<RegisterSession, $this>
     */
    public function sessions(): HasMany
    {
        return $this->hasMany(RegisterSession::class);
    }
}
