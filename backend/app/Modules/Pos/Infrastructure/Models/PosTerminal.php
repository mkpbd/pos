<?php

namespace App\Modules\Pos\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * POS1a: a device (browser) set up as a till of one store. The device holds a random token in the
 * `pos_terminal` cookie; only its SHA-256 is kept here.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $store_id
 * @property string $name
 * @property string $token_hash
 * @property ?string $created_by
 * @property ?Carbon $last_used_at
 * @property ?Carbon $revoked_at
 * @property Carbon $created_at
 */
#[Fillable(['organization_id', 'store_id', 'name', 'token_hash', 'created_by'])]
#[Hidden(['token_hash'])]
class PosTerminal extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
