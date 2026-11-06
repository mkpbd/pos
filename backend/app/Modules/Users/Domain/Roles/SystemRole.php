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
    case OnlineStoreManager = 'online_store_manager';

    public function label(): string
    {
        return match ($this) {
            self::OrganizationAdmin => 'Organization Admin',
            self::BranchManager => 'Branch Manager',
            self::Cashier => 'Cashier',
            self::InventoryManager => 'Inventory Manager',
            self::Accountant => 'Accountant',
            self::OnlineStoreManager => 'Online Store Manager',
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
            self::OnlineStoreManager => 'Runs the online store: storefront, content, online catalog, web orders.',
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
                // SC2: approves requisitions / orders up to the manager limit; above it and the
                // approval limits themselves stay with the Organization Admin.
                'inventory.*', 'purchases.view', 'purchases.manage', 'purchases.receive', 'purchases.return', 'purchases.pay',
                'purchases.request', 'purchases.approve', 'purchases.landed_cost', 'pos.*', 'sales.*', 'returns.*', 'refunds.*',
                'payments.*', 'cash_registers.*', 'expenses.*', 'loyalty.view', 'reports.*', 'ai.*',
            ],
            self::Cashier => [
                'branches.view', 'products.view', 'customers.view', 'customers.create',
                'pos.*', 'sales.view', 'cash_registers.operate', 'returns.view', 'returns.create', 'payments.collect',
                // SC2: branch staff raise purchase requisitions (their own).
                'purchases.request',
            ],
            self::InventoryManager => [
                'branches.view', 'products.*', 'categories.*', 'brands.*', 'units.*',
                'suppliers.*', 'inventory.*', 'reports.inventory',
                // SC2: runs purchasing (requisitions → orders, RFQs) but does not approve.
                'purchases.view', 'purchases.manage', 'purchases.receive', 'purchases.return', 'purchases.pay', 'purchases.request',
                // SC3: books landed cost vouchers (freight / duty bills that arrive later).
                'purchases.landed_cost',
            ],
            self::Accountant => [
                'organization.view', 'branches.view', 'products.view', 'products.view_cost', 'taxes.manage',
                'sales.view', 'purchases.view', 'purchases.pay', 'purchases.landed_cost', 'customers.view', 'suppliers.view',
                'payments.*', 'expenses.*', 'cash_registers.view', 'returns.view', 'reports.*', 'audit.view',
                // E10a: couriers' COD remittances (and the web orders they settle); E10b: online refunds.
                'web_orders.view', 'web_orders.remit', 'web_orders.refund',
            ],
            // Custom CSS and payment gateway credentials stay with the Organization Admin (ADR-016).
            self::OnlineStoreManager => [
                'storefront.view', 'storefront.manage', 'media.*', 'cms.*', 'online_catalog.*', 'attributes.manage',
                'promotions.*', 'shipping.*', 'web_orders.*', 'reviews.*',
                'branches.view', 'products.view', 'inventory.view', 'customers.view',
            ],
        };
    }
}
