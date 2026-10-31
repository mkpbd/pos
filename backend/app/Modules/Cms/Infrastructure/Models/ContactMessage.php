<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A message from the storefront contact form. Never edited; staff only mark it handled.
 *
 * @property string $id
 * @property string $name
 * @property string $email
 * @property ?string $phone
 * @property ?string $subject
 * @property string $message
 * @property ?string $ip
 * @property ?CarbonImmutable $handled_at
 * @property ?string $handled_by
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'name', 'email', 'phone', 'subject', 'message', 'ip', 'handled_at', 'handled_by'])]
class ContactMessage extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'handled_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }
}
