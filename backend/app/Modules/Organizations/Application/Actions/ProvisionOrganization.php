<?php

namespace App\Modules\Organizations\Application\Actions;

use App\Modules\Branches\Application\Actions\CreateBranch;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Actions\CreateUser;
use App\Modules\Users\Application\Actions\ProvisionSystemRoles;
use App\Modules\Users\Application\Actions\SyncPermissionCatalog;
use App\Modules\Users\Application\DTOs\UserData;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Creates a ready-to-trade tenant in one transaction:
 * organization → main branch (with main store) → built-in roles → first Organization Admin.
 */
class ProvisionOrganization
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SyncPermissionCatalog $syncCatalog,
        private readonly ProvisionSystemRoles $provisionRoles,
        private readonly CreateBranch $createBranch,
        private readonly CreateUser $createUser,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @return array{organization: Organization, admin: User}
     */
    public function __invoke(ProvisionOrganizationData $data): array
    {
        return DB::transaction(function () use ($data) {
            $organization = Organization::query()->create([
                'name' => $data->organizationName,
                'slug' => $this->uniqueSlug($data->organizationName),
                'base_currency' => $data->currency,
                'timezone' => $data->timezone,
                'tax_mode' => $data->taxMode,
            ]);

            ($this->syncCatalog)();

            return $this->tenant->runAs($organization->id, function () use ($organization, $data) {
                $branch = ($this->createBranch)(['code' => $data->branchCode, 'name' => $data->branchName]);
                $roles = ($this->provisionRoles)($organization->id);

                $admin = ($this->createUser)(new UserData(
                    name: $data->adminName,
                    email: $data->adminEmail,
                    password: $data->adminPassword,
                    roleIds: [$roles[SystemRole::OrganizationAdmin->value]->id],
                    branchIds: [$branch->id],
                ));

                $this->audit->record('organization.provisioned', $organization, new: [
                    'name' => $organization->name,
                    'slug' => $organization->slug,
                    'base_currency' => $organization->base_currency,
                    'timezone' => $organization->timezone,
                    'tax_mode' => $organization->tax_mode->value,
                ]);

                return ['organization' => $organization, 'admin' => $admin];
            });
        });
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::limit(Str::slug($name) ?: 'organization', 60, '');
        $slug = $base;

        while (Organization::query()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(5));
        }

        return $slug;
    }
}
