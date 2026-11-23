<?php

namespace App\Modules\Users\Infrastructure\Models;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Infrastructure\Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\HasApiTokens;

/**
 * @property string $id
 * @property ?string $organization_id
 * @property string $name
 * @property string $email
 * @property ?string $phone
 * @property bool $is_platform_admin
 * @property UserStatus $status
 * @property ?Carbon $last_login_at
 * @property ?string $two_factor_secret
 * @property ?Carbon $two_factor_confirmed_at
 * @property ?list<string> $two_factor_recovery_codes
 * @property ?int $two_factor_last_step
 * @property int $failed_login_count
 * @property ?Carbon $locked_until
 */
#[UseFactory(UserFactory::class)]
#[Fillable(['organization_id', 'name', 'email', 'phone', 'password', 'status'])]
#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_last_step'])]
class User extends Authenticatable implements TenantUser
{
    /** @use HasFactory<UserFactory> */
    use BelongsToOrganization, HasApiTokens, HasFactory, HasUuids, Notifiable, TracksAuthor;

    protected $attributes = [
        'status' => 'active',
        'is_platform_admin' => false,
    ];

    /** @var array<string, true>|null */
    private ?array $permissionSet = null;

    /** @var list<string>|null */
    private ?array $branchIdCache = null;

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'is_platform_admin' => 'boolean',
            'status' => UserStatus::class,
            // G1a: two-factor sign-in and lockout.
            'two_factor_secret' => 'encrypted',
            'two_factor_confirmed_at' => 'datetime',
            'two_factor_recovery_codes' => 'encrypted:array',
            'two_factor_last_step' => 'integer',
            'failed_login_count' => 'integer',
            'locked_until' => 'datetime',
        ];
    }

    /** Two-factor sign-in is on once the first authenticator code was confirmed. */
    public function hasTwoFactorEnabled(): bool
    {
        return $this->two_factor_confirmed_at !== null && ($this->getAttributes()['two_factor_secret'] ?? null) !== null;
    }

    public function isLocked(): bool
    {
        return $this->locked_until !== null && $this->locked_until->isFuture();
    }

    /**
     * @return BelongsToMany<Role, $this>
     */
    public function roles(): BelongsToMany
    {
        return $this->belongsToMany(Role::class);
    }

    /**
     * @return HasMany<BranchMembership, $this>
     */
    public function branchMemberships(): HasMany
    {
        return $this->hasMany(BranchMembership::class);
    }

    public function organizationId(): ?string
    {
        return $this->organization_id;
    }

    public function isPlatformAdmin(): bool
    {
        return $this->is_platform_admin;
    }

    public function isActive(): bool
    {
        return $this->status === UserStatus::Active;
    }

    public function hasPermission(string $permission): bool
    {
        return $this->isPlatformAdmin() || isset($this->permissionNames()[$permission]);
    }

    /**
     * Permission names granted through the user's roles (memoised per instance).
     *
     * @return array<string, true>
     */
    public function permissionNames(): array
    {
        return $this->permissionSet ??= array_fill_keys(
            DB::table('permission_role')
                ->join('role_user', 'role_user.role_id', '=', 'permission_role.role_id')
                ->where('role_user.user_id', $this->getKey())
                ->distinct()
                ->pluck('permission_role.permission_name')
                ->all(),
            true,
        );
    }

    /**
     * Branch ids assigned to the user (membership), regardless of access_all.
     *
     * @return list<string>
     */
    public function assignedBranchIds(): array
    {
        return $this->branchIdCache ??= ($this->relationLoaded('branchMemberships')
            ? $this->branchMemberships->pluck('branch_id')->all()
            : $this->branchMemberships()->pluck('branch_id')->all());
    }

    public function accessibleBranchIds(): ?array
    {
        return $this->hasPermission('branches.access_all') ? null : $this->assignedBranchIds();
    }

    public function canAccessBranch(string $branchId): bool
    {
        $ids = $this->accessibleBranchIds();

        return $ids === null || in_array($branchId, $ids, true);
    }

    /**
     * Call after changing roles or branch assignments of an already-loaded user.
     */
    public function flushAccessCache(): void
    {
        $this->permissionSet = null;
        $this->branchIdCache = null;
        $this->unsetRelation('branchMemberships');
        $this->unsetRelation('roles');
    }
}
