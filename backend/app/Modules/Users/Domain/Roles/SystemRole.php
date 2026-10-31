<?php

namespace App\Modules\Users\Domain\Roles;

/**
 * Built-in roles provisioned for every organization. Their permission sets are
 * expressed as patterns over the permission catalog, so permissions added by later
 * modules are picked up on the next `pos:permissions:sync`. System roles cannot be
 * edited or deleted; organizations create custom roles for anything else.
 */
enum SystemRole: string
{
    case OrganizationAdmin = 'organization_admin';
    case BranchManager = 'branch_manager';
    case Cashier = 'cashier';
    case InventoryManager = 'inventory_manager';
    case Accountant = 'accountant';

    public function label(): string
    {
        return match ($this) {
            self::OrganizationAdmin => 'Organization Admin',
            self::BranchManager => 'Branch Manager',
            self::Cashier => 'Cashier',
            self::InventoryManager => 'Inventory Manager',
            self::Accountant => 'Accountant',
        };
    }

    public function description(): string
    {
        return match ($this) {
            self::OrganizationAdmin => 'Full access to every module and branch of the organization.',
            self::BranchManager => 'Runs day-to-day operations of assigned branches.',
            self::Cashier => 'Operates the POS terminal and serves customers.',
            self::InventoryManager => 'Manages products, stock and purchasing.',
            self::Accountant => 'Manages payments and expenses, reads financial reports.',
        };
    }

    /**
     * @return list<string>
     */
    public function permissionPatterns(): array
    {
        return match ($this) {
            self::OrganizationAdmin => ['*'],
            self::BranchManager => [
                'organization.view', 'branches.view', 'users.view', 'roles.view',
                'products.*', 'categories.*', 'brands.*', 'units.*', 'customers.*', 'suppliers.*',
                'inventory.*', 'purchases.*', 'pos.*', 'sales.*', 'returns.*', 'refunds.*',
                'payments.*', 'cash_registers.*', 'expenses.*', 'loyalty.view', 'reports.*', 'ai.*',
            ],
            self::Cashier => [
                'branches.view', 'products.view', 'customers.view', 'customers.create',
                'pos.*', 'sales.view', 'cash_registers.operate', 'returns.view', 'returns.create', 'payments.collect',
            ],
            self::InventoryManager => [
                'branches.view', 'products.*', 'categories.*', 'brands.*', 'units.*',
                'suppliers.*', 'inventory.*', 'purchases.*', 'reports.inventory',
            ],
            self::Accountant => [
                'organization.view', 'branches.view', 'products.view', 'products.view_cost', 'taxes.manage',
                'sales.view', 'purchases.view', 'purchases.pay', 'customers.view', 'suppliers.view',
                'payments.*', 'expenses.*', 'cash_registers.view', 'returns.view', 'reports.*', 'audit.view',
            ],
        };
    }
}
