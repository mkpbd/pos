<?php

namespace App\Modules\CustomerAccounts\Infrastructure\Models;

use App\Modules\CustomerAccounts\Domain\AccountStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * The authenticatable of the `customer` guard. Lookups are tenant-scoped, so a session of
 * one store is anonymous on another store's host.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $customer_id
 * @property string $email
 * @property ?string $phone
 * @property string $password
 * @property AccountStatus $status
 * @property ?CarbonImmutable $email_verified_at
 * @property ?string $email_verification_token_hash
 * @property ?CarbonImmutable $email_verification_sent_at
 * @property ?CarbonImmutable $last_login_at
 * @property ?CarbonImmutable $created_at
 * @property ?string $preferred_locale en | bn, from the last sign-up / sign-in (E12b)
 */
#[Fillable(['organization_id', 'customer_id', 'email', 'phone', 'password', 'status'])]
#[Hidden(['password', 'remember_token', 'email_verification_token_hash'])]
class CustomerAccount extends Authenticatable
{
    use BelongsToOrganization, HasUuids, Notifiable;

    protected $attributes = [
        'status' => 'active',
    ];

    protected function casts(): array
    {
        return [
            'password' => 'hashed',
            'status' => AccountStatus::class,
            'email_verified_at' => 'immutable_datetime',
            'email_verification_sent_at' => 'immutable_datetime',
            'last_login_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === AccountStatus::Active;
    }
}
