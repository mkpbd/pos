<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * T1: theme presets and layout variants.
 */
class ThemePresetsTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const LAYOUT_DEFAULTS = [
        'container_width' => 1170,
        'sticky_header' => true,
        'header_style' => 'standard',
        'footer_style' => 'columns',
        'card_style' => 'standard',
        'hero_style' => 'full',
        'heading_case' => 'normal',
        'top_bar' => 'none',
        // B4: products per row on listings (today's grid).
        'listing_columns' => ['desktop' => 3, 'tablet' => 3, 'mobile' => 2],
    ];

    public function test_a_theme_stored_before_presets_reads_as_todays_look(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        // The document as saved before T1: no preset, two layout keys.
        $this->inTenant($org, fn () => ThemeSettings::query()->create(['settings' => [
            'colors' => ['primary' => '#123456'],
            'typography' => ['heading_font' => 'poppins', 'body_font' => 'poppins'],
            'shape' => ['button_style' => 'rounded', 'card_radius' => 8],
            'layout' => ['container_width' => 1280, 'sticky_header' => false],
        ]]));
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/storefront/theme')->assertOk()
            ->assertJsonPath('data.settings.preset', 'default')
            ->assertJsonPath('data.settings.colors.primary', '#123456')
            ->assertJsonPath('data.settings.typography.heading_font', 'poppins')
            ->assertJsonPath('data.settings.layout', ['container_width' => 1280, 'sticky_header' => false] + self::LAYOUT_DEFAULTS);

        // A new organization gets exactly the defaults.
        ['admin' => $other] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other);
        $this->getJson('/api/v1/storefront/theme')->assertOk()
            ->assertJsonPath('data.settings.preset', 'default')
            ->assertJsonPath('data.settings.layout', self::LAYOUT_DEFAULTS);
    }

    public function test_new_fonts_and_layout_fields_are_saved_and_validated(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->putJson('/api/v1/storefront/theme', [
            'preset' => 'handmade',
            'typography' => ['heading_font' => 'playfair', 'body_font' => 'jost'],
            'layout' => ['header_style' => 'commerce', 'footer_style' => 'widgets', 'card_style' => 'minimal', 'hero_style' => 'tiles', 'heading_case' => 'uppercase', 'top_bar' => 'ticker'],
        ])->assertOk()
            ->assertJsonPath('data.settings.preset', 'handmade')
            ->assertJsonPath('data.settings.typography', ['heading_font' => 'playfair', 'body_font' => 'jost'] + ThemeSchema::defaults()['typography'])
            ->assertJsonPath('data.settings.layout', [
                'container_width' => 1170, 'sticky_header' => true,
                'header_style' => 'commerce', 'footer_style' => 'widgets', 'card_style' => 'minimal',
                'hero_style' => 'tiles', 'heading_case' => 'uppercase', 'top_bar' => 'ticker',
                'listing_columns' => ['desktop' => 3, 'tablet' => 3, 'mobile' => 2],
            ]);

        $this->putJson('/api/v1/storefront/theme', ['typography' => ['heading_font' => 'jost', 'body_font' => 'jost']])->assertOk();

        $invalid = [
            'preset' => ['preset' => 'neon'],
            'typography.body_font' => ['typography' => ['body_font' => 'playfair']],
            'layout.header_style' => ['layout' => ['header_style' => 'floating']],
            'layout.footer_style' => ['layout' => ['footer_style' => 'mega']],
            'layout.card_style' => ['layout' => ['card_style' => 'flip']],
            'layout.hero_style' => ['layout' => ['hero_style' => 'video']],
            'layout.heading_case' => ['layout' => ['heading_case' => 'capitalize']],
            'layout.top_bar' => ['layout' => ['top_bar' => 'banner']],
        ];
        foreach ($invalid as $field => $body) {
            $this->putJson('/api/v1/storefront/theme', $body)
                ->assertStatus(422)->assertJsonValidationErrorFor($field, 'error.details');
        }
    }

    public function test_presets_are_listed_with_the_complete_theme_each_produces(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $response = $this->getJson('/api/v1/storefront/theme/presets')->assertOk()
            ->assertJsonCount(5, 'data')
            ->assertJsonPath('data.*.key', ['default', 'vegan', 'handmade', 'classic', 'kids'])
            ->assertJsonPath('data.4.name', 'BerryKid Kids Store')
            ->assertJsonPath('data.4.theme.layout.card_style', 'arched')
            ->assertJsonPath('data.0.theme', ThemeSchema::defaults())
            ->assertJsonPath('data.1.name', 'Vegan Store')
            ->assertJsonPath('data.1.theme.layout.heading_case', 'lowercase')
            ->assertJsonPath('data.2.theme.typography', ['heading_font' => 'playfair', 'body_font' => 'jost'] + ThemeSchema::defaults()['typography'])
            ->assertJsonPath('data.2.theme.layout.header_style', 'centered')
            ->assertJsonPath('data.3.theme.layout.header_style', 'commerce')
            ->assertJsonPath('data.3.theme.preset', 'classic');

        foreach ($response->json('data') as $preset) {
            $this->assertNotSame('', $preset['name']);
            $this->assertNotSame('', $preset['description']);
            // Complete document: exactly the schema's keys.
            $this->assertSame(array_keys(ThemeSchema::defaults()), array_keys($preset['theme']));
            $this->assertSame(array_keys(ThemeSchema::defaults()['layout']), array_keys($preset['theme']['layout']));
        }
    }

    public function test_applying_a_preset_replaces_the_look_and_keeps_the_content(): void
    {
        Storage::fake('public');
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $logo = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('logo.png', 400, 120), 'alt' => 'Berry Kids'], $this->spaHeaders())->json('data');

        $content = [
            'logo_media_id' => $logo['id'],
            'favicon_media_id' => $logo['id'],
            'announcement' => [
                'enabled' => true, 'text' => 'Free delivery over ৳2000', 'link' => '/shipping',
                'background' => '#000000', 'foreground' => '#ffffff',
                'starts_at' => null, 'ends_at' => null, 'translations' => ['bn' => ['text' => '৳২০০০ এর বেশি অর্ডারে ফ্রি ডেলিভারি']],
            ],
            'footer' => [
                'about' => 'Clothes for little ones.',
                'copyright' => '© Berry Kids',
                'contact' => ['email' => 'hello@berry.test', 'phone' => '+8801700000000', 'address' => 'Dhaka'],
                'social' => ['facebook' => 'https://facebook.com/berrykids'],
                'payment_logo_media_ids' => [$logo['id']],
            ],
        ];
        $this->putJson('/api/v1/storefront/theme', $content + ['colors' => ['primary' => '#123456'], 'layout' => ['container_width' => 1400]])->assertOk();
        $this->putJson('/api/v1/storefront/theme/custom-css', ['custom_css' => '.x{color:red}'])->assertOk();
        $before = $this->getJson('/api/v1/storefront/theme')->json('data.settings');

        // B3: the preset goes to the draft (the response is the draft payload).
        $saved = $this->postJson('/api/v1/storefront/theme/presets/classic/apply')->assertOk()
            ->assertJsonPath('data.custom_css', '.x{color:red}')
            ->assertJsonPath('data.has_custom_css', true)
            ->assertJsonPath('data.has_unpublished_changes', true)
            ->json('data.settings');

        $classic = ThemePresets::theme('classic');
        foreach (ThemePresets::PRESENTATION_KEYS as $key) {
            $this->assertSame($classic[$key], $saved[$key], $key);
        }
        foreach (['palette', 'logo_media_id', 'favicon_media_id', 'announcement', 'footer'] as $key) {
            $this->assertSame($before[$key], $saved[$key], $key);
        }
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_preset_applied']);

        // Live only once published.
        $this->assertSame($before, $this->getJson('/api/v1/storefront/theme')->json('data.settings'));
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk()->assertJsonPath('data.has_unpublished_changes', false);
        $this->assertSame($saved, $this->getJson('/api/v1/storefront/theme')->json('data.settings'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_updated']);

        // Back to today's look; the content still stays.
        $this->postJson('/api/v1/storefront/theme/presets/default/apply')->assertOk()
            ->assertJsonPath('data.settings.preset', 'default')
            ->assertJsonPath('data.settings.colors.primary', '#f59e0b')
            ->assertJsonPath('data.settings.layout', self::LAYOUT_DEFAULTS)
            ->assertJsonPath('data.settings.footer.about', 'Clothes for little ones.')
            ->assertJsonPath('data.settings.logo_media_id', $logo['id']);
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings.preset', 'classic');
    }

    public function test_unknown_presets_are_not_found(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/storefront/theme/presets/neon/apply')
            ->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings.preset', 'default');
    }

    public function test_presets_need_the_theme_permissions(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $viewerRole = $this->inTenant($org, function () {
            $role = Role::query()->create(['name' => 'Storefront viewer']);
            $role->permissions()->sync(['storefront.view']);

            return $role;
        });
        $viewer = $this->createUserWithRole($org, $viewerRole);
        $manager = $this->createUserWithRole($org, SystemRole::OnlineStoreManager);

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/storefront/theme/presets')->assertForbidden();
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertForbidden();

        $this->actingAsUser($viewer);
        $this->getJson('/api/v1/storefront/theme/presets')->assertOk();
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertForbidden();
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings.preset', 'default');

        $this->actingAsUser($manager);
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk()
            ->assertJsonPath('data.settings.preset', 'vegan')
            ->assertJsonPath('data.custom_css', null);
    }

    public function test_applying_a_preset_in_one_organization_leaves_the_others_alone(): void
    {
        ['admin' => $a] = $this->provisionTenant('Shop A');
        ['admin' => $b] = $this->provisionTenant('Shop B');

        $this->actingAsUser($b);
        $this->putJson('/api/v1/storefront/theme', ['colors' => ['primary' => '#abcdef']])->assertOk();

        $this->actingAsUser($a);
        $this->postJson('/api/v1/storefront/theme/presets/handmade/apply')->assertOk()->assertJsonPath('data.settings.preset', 'handmade');
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings.preset', 'handmade');

        $this->actingAsUser($b);
        $this->getJson('/api/v1/storefront/theme/draft')->assertOk()
            ->assertJsonPath('data.settings.preset', 'default')
            ->assertJsonPath('data.settings.colors.primary', '#abcdef');
        $this->getJson('/api/v1/storefront/theme')->assertOk()
            ->assertJsonPath('data.settings.preset', 'default')
            ->assertJsonPath('data.settings.colors.primary', '#abcdef')
            ->assertJsonPath('data.settings.layout', self::LAYOUT_DEFAULTS);
    }

    public function test_the_storefront_bootstrap_carries_the_preset_and_layout(): void
    {
        ['admin' => $admin] = $this->provisionTenant('Berry Kids');
        $this->actingAsUser($admin);
        $this->postJson('/api/v1/storefront/domains', ['host' => 'berry.test'])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['is_enabled' => true])->assertOk();
        $this->app['auth']->forgetGuards();

        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.preset', 'default')
            ->assertJsonPath('data.theme.layout', self::LAYOUT_DEFAULTS);

        $this->actingAsUser($admin);
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk();
        $this->app['auth']->forgetGuards();

        // B3: applied to the draft only — shoppers still get the live look.
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.theme.preset', 'default');

        $this->actingAsUser($admin);
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->app['auth']->forgetGuards();

        // The cached bootstrap is replaced by the new look.
        $vegan = ThemePresets::theme('vegan');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.preset', 'vegan')
            ->assertJsonPath('data.theme.colors', $vegan['colors'])
            ->assertJsonPath('data.theme.typography', $vegan['typography'])
            ->assertJsonPath('data.theme.shape', $vegan['shape'])
            ->assertJsonPath('data.theme.layout', $vegan['layout']);
    }
}
