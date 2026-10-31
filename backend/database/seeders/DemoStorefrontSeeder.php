<?php

namespace Database\Seeders;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Actions\ReplaceMenuItems;
use App\Modules\Storefront\Application\Actions\SaveMenu;
use App\Modules\Storefront\Application\Actions\SaveStorefrontDomain;
use App\Modules\Storefront\Application\Actions\SaveStorefrontSettings;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Database\Seeder;

/**
 * An open demo storefront on the local development host (STOREFRONT_DEFAULT_HOST,
 * default shop.localhost), created through the real use cases. Menus only link to
 * pages that exist in this phase.
 */
class DemoStorefrontSeeder extends Seeder
{
    public function run(
        string $organizationId,
        TenantContext $tenant,
        SaveStorefrontDomain $saveDomain,
        SaveStorefrontSettings $saveSettings,
        SaveMenu $saveMenu,
        ReplaceMenuItems $replaceItems,
    ): void {
        $host = (string) (config('storefront.default_host') ?: 'shop.localhost');

        $tenant->runAs($organizationId, function () use ($host, $saveDomain, $saveSettings, $saveMenu, $replaceItems) {
            $saveDomain(new StorefrontDomain, ['host' => $host]);
            $saveSettings([
                'is_enabled' => true,
                'site_name' => 'Demo Mart',
                'meta_description' => 'Groceries and household goods from Demo Mart, Dhaka.',
            ]);

            $main = $saveMenu->save(new Menu, ['name' => 'Main navigation', 'location' => 'main']);
            $replaceItems($main, [['label' => 'Home', 'url' => '/']]);

            $footer = $saveMenu->save(new Menu, ['name' => 'Demo Mart', 'location' => 'footer_1']);
            $replaceItems($footer, [['label' => 'Home', 'url' => '/']]);
        });
    }
}
