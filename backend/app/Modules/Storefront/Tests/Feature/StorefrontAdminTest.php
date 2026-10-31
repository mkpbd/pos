<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StorefrontAdminTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_settings_default_to_a_closed_store_named_after_the_organization(): void
    {
        ['admin' => $admin] = $this->provisionTenant('Berry Babies');
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/storefront/settings')->assertOk()
            ->assertJsonPath('data.is_enabled', false)
            ->assertJsonPath('data.site_name', 'Berry Babies');

        $this->patchJson('/api/v1/storefront/settings', ['site_name' => 'BerryKids BD', 'meta_description' => 'Baby clothes and toys'])
            ->assertOk()->assertJsonPath('data.site_name', 'BerryKids BD');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.settings_updated']);
    }

    public function test_opening_the_store_needs_a_domain_and_an_open_store_keeps_one(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => true])
            ->assertStatus(422)->assertJsonPath('error.code', 'STOREFRONT_DOMAIN_REQUIRED');

        $first = $this->postJson('/api/v1/storefront/domains', ['host' => '  Shop.Example.COM '])
            ->assertCreated()->assertJsonPath('data.host', 'shop.example.com')->assertJsonPath('data.is_primary', true)->json('data.id');
        $second = $this->postJson('/api/v1/storefront/domains', ['host' => 'www.example.com'])
            ->assertCreated()->assertJsonPath('data.is_primary', false)->json('data.id');

        $this->patchJson("/api/v1/storefront/domains/{$second}", ['is_primary' => true])->assertOk()->assertJsonPath('data.is_primary', true);
        $this->getJson('/api/v1/storefront/domains')->assertOk()
            ->assertJsonPath('data.0.host', 'www.example.com')
            ->assertJsonPath('data.1.is_primary', false);

        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => true])->assertOk()->assertJsonPath('data.is_enabled', true);

        // Removing the primary promotes the other; the last domain of an open store stays.
        $this->deleteJson("/api/v1/storefront/domains/{$second}")->assertNoContent();
        $this->getJson('/api/v1/storefront/domains')->assertJsonPath('data.0.id', $first)->assertJsonPath('data.0.is_primary', true);
        $this->deleteJson("/api/v1/storefront/domains/{$first}")
            ->assertStatus(422)->assertJsonPath('error.code', 'STOREFRONT_DOMAIN_REQUIRED');
    }

    public function test_domains_are_plain_host_names_owned_by_one_organization(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');

        $this->actingAsUser($otherAdmin);
        $this->postJson('/api/v1/storefront/domains', ['host' => 'taken.example.com'])->assertCreated();

        $this->actingAsUser($admin);
        foreach (['https://shop.example.com', 'shop.example.com:8080', 'shop.example.com/path', '-bad.example.com', 'TAKEN.example.com'] as $host) {
            $this->postJson('/api/v1/storefront/domains', ['host' => $host])
                ->assertStatus(422)->assertJsonValidationErrorFor('host', 'error.details');
        }
    }

    public function test_theme_is_a_complete_document_with_defaults_and_validated_values(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/storefront/theme')->assertOk()
            ->assertJsonPath('data.settings.colors.primary', '#f59e0b')
            ->assertJsonPath('data.settings.layout.container_width', 1170)
            ->assertJsonPath('data.settings.footer.payment_logo_media_ids', []);

        $this->putJson('/api/v1/storefront/theme', [
            'colors' => ['primary' => '#FF8800', 'unknown' => '#000000'],
            'layout' => ['sticky_header' => false],
            'announcement' => ['enabled' => true, 'text' => 'Free delivery in Dhaka over ৳2000', 'link' => '/shipping'],
            'not_a_key' => 'dropped',
        ])->assertOk()
            ->assertJsonPath('data.settings.colors.primary', '#FF8800')
            ->assertJsonPath('data.settings.colors.accent', '#6f55c2')
            ->assertJsonPath('data.settings.layout.sticky_header', false)
            ->assertJsonPath('data.settings.layout.container_width', 1170)
            ->assertJsonPath('data.settings.announcement.text', 'Free delivery in Dhaka over ৳2000')
            ->assertJsonMissingPath('data.settings.colors.unknown')
            ->assertJsonMissingPath('data.settings.not_a_key');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_updated']);

        $this->putJson('/api/v1/storefront/theme', ['colors' => ['primary' => 'red']])->assertStatus(422);
        $this->putJson('/api/v1/storefront/theme', ['typography' => ['heading_font' => 'Comic Sans']])->assertStatus(422);
        $this->putJson('/api/v1/storefront/theme', ['announcement' => ['enabled' => true]])->assertStatus(422);
        $this->putJson('/api/v1/storefront/theme', ['announcement' => ['link' => 'javascript:alert(1)']])->assertStatus(422);
        $this->putJson('/api/v1/storefront/theme', ['footer' => ['social' => ['facebook' => 'http://facebook.com/x']]])->assertStatus(422);
        $this->putJson('/api/v1/storefront/theme', ['logo_media_id' => '0192f0c8-0000-7000-8000-000000000000'])
            ->assertStatus(422)->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');
    }

    public function test_custom_css_is_restricted_by_permission_and_policy(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $manager = $this->createUserWithRole($org, SystemRole::OnlineStoreManager);

        $this->actingAsUser($manager);
        $this->putJson('/api/v1/storefront/theme', ['colors' => ['primary' => '#123456']])->assertOk()->assertJsonPath('data.custom_css', null);
        $this->putJson('/api/v1/storefront/theme/custom-css', ['custom_css' => '.x{}'])->assertForbidden();

        $this->actingAsUser($admin);
        foreach (['</style><script>alert(1)</script>', '@import url(https://evil.test/x.css);', '.a{background:url(https://evil.test/p.png)}', '.a{width:expression(alert(1))}', '.a{content:"\\3c"}'] as $css) {
            $this->putJson('/api/v1/storefront/theme/custom-css', ['custom_css' => $css])
                ->assertStatus(422)->assertJsonPath('error.code', 'CUSTOM_CSS_REJECTED');
        }

        $this->putJson('/api/v1/storefront/theme/custom-css', ['custom_css' => ".hero{background:url('/storage/media/x.png')}"])
            ->assertOk()->assertJsonPath('data.custom_css', ".hero{background:url('/storage/media/x.png')}");
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.custom_css_updated']);

        // The theme save of the manager does not wipe the CSS they cannot see.
        $this->actingAsUser($manager);
        $this->putJson('/api/v1/storefront/theme', ['colors' => ['primary' => '#654321']])->assertOk()->assertJsonPath('data.has_custom_css', true);
    }

    public function test_menus_one_per_location_with_a_validated_item_tree(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $main = $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->assertCreated()->json('data.id');
        $footer = $this->postJson('/api/v1/storefront/menus', ['name' => 'Help', 'location' => 'footer_1'])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/storefront/menus', ['name' => 'Again', 'location' => 'main'])->assertStatus(422);
        $this->postJson('/api/v1/storefront/menus', ['name' => 'Nope', 'location' => 'sidebar'])->assertStatus(422);

        $tree = [
            ['label' => 'Boys', 'url' => '/boys', 'is_mega' => true, 'mega_columns' => 3, 'children' => [
                ['label' => 'Clothing', 'url' => '/boys/clothing', 'children' => [
                    ['label' => 'T-shirts', 'url' => '/boys/clothing/t-shirts'],
                ]],
            ]],
            ['label' => 'Blog', 'url' => 'https://blog.example.com', 'open_in_new_tab' => true, 'is_visible' => false],
        ];
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => $tree])->assertOk()
            ->assertJsonPath('data.items.0.label', 'Boys')
            ->assertJsonPath('data.items.0.is_mega', true)
            ->assertJsonPath('data.items.0.mega_columns', 3)
            ->assertJsonPath('data.items.0.children.0.children.0.label', 'T-shirts')
            ->assertJsonPath('data.items.1.is_visible', false);

        // Saving again replaces, not appends.
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => [$tree[1]]])->assertOk()->assertJsonCount(1, 'data.items');
        $this->assertDatabaseCount('menu_items', 1);

        $fourLevels = [['label' => 'a', 'url' => '/a', 'children' => [['label' => 'b', 'url' => '/b', 'children' => [['label' => 'c', 'url' => '/c', 'children' => [['label' => 'd', 'url' => '/d']]]]]]]];
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => $fourLevels])->assertStatus(422);
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => [['label' => 'x', 'url' => 'javascript:alert(1)']]])->assertStatus(422);
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => [['label' => 'x', 'url' => '//evil.test']]])->assertStatus(422);
        $this->putJson("/api/v1/storefront/menus/{$footer}/items", ['items' => [['label' => 'x', 'url' => '/x', 'is_mega' => true]]])
            ->assertStatus(422)->assertJsonPath('error.code', 'MEGA_MENU_NOT_ALLOWED');
        $this->putJson("/api/v1/storefront/menus/{$main}/items", ['items' => [['label' => 'x', 'url' => '/x', 'children' => [['label' => 'y', 'url' => '/y', 'is_mega' => true]]]]])
            ->assertStatus(422)->assertJsonPath('error.code', 'MEGA_MENU_NOT_ALLOWED');

        $this->deleteJson("/api/v1/storefront/menus/{$footer}")->assertNoContent();
        $this->assertDatabaseHas('audit_logs', ['action' => 'menu.deleted', 'subject_id' => $footer]);
    }

    public function test_online_store_manager_runs_the_storefront_and_cashiers_cannot(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $manager = $this->createUserWithRole($org, SystemRole::OnlineStoreManager);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $this->actingAsUser($manager);
        $this->postJson('/api/v1/storefront/domains', ['host' => 'shop.example.com'])->assertCreated();
        $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'main'])->assertCreated();

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/storefront/settings')->assertForbidden();
        $this->getJson('/api/v1/storefront/theme')->assertForbidden();
        $this->postJson('/api/v1/storefront/menus', ['name' => 'Main', 'location' => 'mobile'])->assertForbidden();
    }
}
