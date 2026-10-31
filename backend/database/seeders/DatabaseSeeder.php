<?php

namespace Database\Seeders;

use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Actions\CreateUser;
use App\Modules\Users\Application\Actions\SyncPermissionCatalog;
use App\Modules\Users\Application\DTOs\UserData;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Local development data. Refuses to run in production.
 *
 *   platform admin:  admin@pos.test    / password
 *   org admin:       owner@demo.test   / password
 *   cashier:         cashier@demo.test / password
 */
class DatabaseSeeder extends Seeder
{
    public function run(
        SyncPermissionCatalog $syncCatalog,
        ProvisionOrganization $provision,
        CreateUser $createUser,
        TenantContext $tenant,
    ): void {
        if (app()->isProduction()) {
            throw new RuntimeException('The development seeder must not run in production.');
        }

        $syncCatalog();

        $platformAdmin = User::query()->create([
            'name' => 'Platform Admin',
            'email' => 'admin@pos.test',
            'password' => 'password',
        ]);
        $platformAdmin->forceFill(['is_platform_admin' => true, 'email_verified_at' => now()])->save();

        $result = $provision(new ProvisionOrganizationData(
            organizationName: 'Demo Mart',
            adminName: 'Demo Owner',
            adminEmail: 'owner@demo.test',
            adminPassword: 'password',
            currency: config('pos.default_currency'),
            timezone: config('pos.default_timezone'),
            branchName: 'Dhaka Main',
        ));

        $tenant->runAs($result['organization']->id, function () use ($createUser, $result) {
            $cashierRole = Role::query()->where('system_key', SystemRole::Cashier->value)->firstOrFail();

            $createUser(new UserData(
                name: 'Demo Cashier',
                email: 'cashier@demo.test',
                password: 'password',
                roleIds: [$cashierRole->id],
                branchIds: $result['admin']->assignedBranchIds(),
            ));
        });

        $this->callWith(DemoCatalogSeeder::class, ['organizationId' => $result['organization']->id]);
        $this->callWith(DemoStockSeeder::class, ['organizationId' => $result['organization']->id, 'adminId' => $result['admin']->id]);
        $this->callWith(DemoSalesSeeder::class, ['organizationId' => $result['organization']->id, 'adminId' => $result['admin']->id]);
        $this->callWith(DemoStorefrontSeeder::class, ['organizationId' => $result['organization']->id, 'adminId' => $result['admin']->id]);
    }
}
