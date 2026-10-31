<?php

namespace App\Modules\Users\Tests\Unit;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Users\Domain\Roles\SystemRole;
use PHPUnit\Framework\TestCase;

class PermissionRegistryTest extends TestCase
{
    private function registry(): PermissionRegistry
    {
        $registry = new PermissionRegistry;
        $registry->register('Users', ['users.view' => 'View', 'users.manage' => 'Manage']);
        $registry->register('Sales', ['sales.view' => 'View', 'sales.void' => 'Void']);
        $registry->register('Pos', ['pos.checkout' => 'Checkout']);

        return $registry;
    }

    public function test_matching_supports_wildcards_and_exact_names(): void
    {
        $registry = $this->registry();

        $this->assertSame(['users.manage', 'users.view'], $registry->matching(['users.*']));
        $this->assertSame(['sales.view'], $registry->matching(['sales.view', 'unknown.*']));
        $this->assertCount(5, $registry->matching(['*']));
        $this->assertSame([], $registry->matching([]));
    }

    public function test_cashier_never_gets_management_permissions(): void
    {
        $granted = $this->registry()->matching(SystemRole::Cashier->permissionPatterns());

        $this->assertSame(['pos.checkout', 'sales.view'], $granted);
    }

    public function test_every_system_role_has_label_and_patterns(): void
    {
        foreach (SystemRole::cases() as $role) {
            $this->assertNotSame('', $role->label());
            $this->assertNotEmpty($role->permissionPatterns());
        }
    }
}
