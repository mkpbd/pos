<?php

namespace App\Modules\Shared\Tests\Concerns;

use App\Modules\Branches\Application\Actions\CreateBranch;
use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Actions\CreateUser;
use App\Modules\Users\Application\DTOs\UserData;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

/**
 * Builds tenants through the real provisioning use case, so tests exercise
 * the same roles, permissions and branch wiring as production.
 */
trait InteractsWithTenancy
{
    /**
     * @return array{organization: Organization, admin: User, branch: Branch}
     */
    protected function provisionTenant(string $name = 'Acme Retail'): array
    {
        $result = app(ProvisionOrganization::class)(new ProvisionOrganizationData(
            organizationName: $name,
            adminName: 'Owner of '.$name,
            adminEmail: Str::lower(Str::random(8)).'@'.Str::slug($name).'.test',
            adminPassword: 'password1',
            currency: 'BDT',
            timezone: 'Asia/Dhaka',
        ));

        $branch = Branch::query()->withoutGlobalScopes()->where('organization_id', $result['organization']->id)->firstOrFail();

        return $result + ['branch' => $branch];
    }

    /**
     * @param  list<string>  $branchIds
     */
    protected function createUserWithRole(Organization $organization, SystemRole|Role $role, array $branchIds = [], string $password = 'password1'): User
    {
        return $this->inTenant($organization, function () use ($role, $branchIds, $password) {
            $roleId = $role instanceof Role ? $role->id : Role::query()->where('system_key', $role->value)->firstOrFail()->id;

            return app(CreateUser::class)(new UserData(
                name: 'User '.Str::random(5),
                email: Str::lower(Str::random(10)).'@example.test',
                password: $password,
                roleIds: [$roleId],
                branchIds: $branchIds,
            ));
        });
    }

    protected function createBranch(Organization $organization, string $code): Branch
    {
        return $this->inTenant($organization, fn () => app(CreateBranch::class)(['code' => $code, 'name' => "Branch {$code}"]));
    }

    /**
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    protected function inTenant(Organization $organization, callable $callback): mixed
    {
        return app(TenantContext::class)->runAs($organization->id, $callback);
    }

    protected function actingAsUser(User $user): static
    {
        Sanctum::actingAs($user->fresh(), ['*']);

        return $this;
    }

    /**
     * Headers that make Sanctum treat the request as coming from the first-party SPA.
     *
     * @return array<string, string>
     */
    protected function spaHeaders(): array
    {
        return ['Referer' => 'http://'.array_values(array_filter(config('sanctum.stateful')))[0]];
    }
}
