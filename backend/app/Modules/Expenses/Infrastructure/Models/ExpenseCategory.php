<?php

namespace App\Modules\Expenses\Infrastructure\Models;

use App\Modules\Expenses\Domain\EntryType;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property EntryType $type
 * @property string $name
 * @property bool $is_active
 */
#[Fillable(['organization_id', 'type', 'name', 'is_active'])]
class ExpenseCategory extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'type' => EntryType::class,
            'is_active' => 'boolean',
        ];
    }
}
