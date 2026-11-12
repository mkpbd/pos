<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Application\Builder\ManageThemeDraft;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * B3: the theme draft → publish flow, the design keys through the API, the staff draft preview
 * of the theme, permissions and tenant isolation.
 */
class ThemeDraftTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const DRAFT = '/api/v1/storefront/theme/draft';

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Date::setTestNow('2026-11-11T10:00:00+06:00');
    }

    /**
     * An open storefront on $host; its admin stays signed in.
     *
     * @return array{organization: Organization, admin: User}
     */
    private function store(string $name, string $host): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => $name, 'is_enabled' => true])->assertOk();

        return $tenant;
    }

    /**
     * @param  list<string>  $permissions
     */
    private function role(Organization $organization, string $name, array $permissions): User
    {
        $role = $this->inTenant($organization, function () use ($name, $permissions) {
            $role = Role::query()->create(['name' => $name]);
            $role->permissions()->sync($permissions);

            return $role;
        });

        return $this->createUserWithRole($organization, $role);
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function saveDraft(array $settings): int
    {
        $revision = $this->getJson(self::DRAFT)->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DRAFT, ['revision' => $revision, 'settings' => $settings])->assertOk()->json('data.draft_revision');
    }

    private function asVisitor(): void
    {
        $this->app['auth']->forgetGuards();
    }

    public function test_reading_the_draft_before_any_edit_is_the_live_theme_and_writes_nothing(): void
    {
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->inTenant($org, fn () => ThemeSettings::query()->create(['settings' => ['colors' => ['primary' => '#123456']]]));

        $response = $this->getJson(self::DRAFT)->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.draft_revision', 0)
            ->assertJsonPath('data.has_unpublished_changes', false)
            ->assertJsonPath('data.published', null)
            ->assertJsonPath('data.draft_updated_at', null)
            ->assertJsonPath('data.preview_url', $this->storeUrl('berry.test').'/?preview=draft')
            ->assertJsonPath('data.custom_css', null)
            ->assertJsonPath('data.has_custom_css', false);
        $this->assertSame($this->getJson('/api/v1/storefront/theme')->json('data.settings'), $response->json('data.settings'));
        $this->assertSame('#123456', $response->json('data.settings.colors.button'));
        $this->getJson('/api/v1/storefront/theme/versions')->assertOk()->assertJsonCount(0, 'data');
        $this->assertDatabaseCount('builder_documents', 0);
    }

    public function test_draft_saves_are_validated_conflict_safe_and_not_live(): void
    {
        $this->store('Berry Kids', 'berry.test');
        $live = $this->getJson('/api/v1/storefront/theme')->json('data.settings');

        $draft = $this->putJson(self::DRAFT, ['revision' => 0, 'settings' => [
            'colors' => ['primary' => '#0f766e', 'button' => '#111111', 'button_foreground' => '#ffffff', 'button_hover' => '#333333', 'link' => '#1d4ed8'],
            'typography' => ['heading_font' => 'jost', 'body_size' => 17, 'heading_scale' => 1.333, 'line_height' => 1.6, 'heading_weight' => 800, 'mobile_scale' => 0.9, 'letter_spacing' => 0.01],
            'palette' => [['name' => 'Brand teal', 'hex' => '#0F766E'], ['name' => 'Glass', 'hex' => '#ffffff80']],
        ]])->assertOk()
            ->assertJsonPath('data.draft_revision', 1)
            ->assertJsonPath('data.has_unpublished_changes', true)
            ->assertJsonPath('data.published', null)
            ->assertJsonPath('data.settings.colors.button_hover', '#333333')
            ->assertJsonPath('data.settings.colors.accent', '#6f55c2')
            ->assertJsonPath('data.settings.typography', [
                'heading_font' => 'jost', 'body_font' => 'poppins', 'body_size' => 17, 'heading_scale' => 1.333,
                'line_height' => 1.6, 'heading_weight' => 800, 'mobile_scale' => 0.9, 'letter_spacing' => 0.01,
            ])
            ->assertJsonPath('data.settings.palette', [['name' => 'Brand teal', 'hex' => '#0f766e'], ['name' => 'Glass', 'hex' => '#ffffff80']])
            ->json('data.settings');
        $this->assertSame(array_keys(ThemeSchema::defaults()), array_keys($draft));

        // The live theme (and the store) are unchanged.
        $this->assertSame($live, $this->getJson('/api/v1/storefront/theme')->json('data.settings'));
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.colors.primary', '#f59e0b')
            ->assertJsonMissingPath('data.theme_source');
        $this->actingAsUser(User::query()->firstOrFail());

        // A stale revision.
        $this->putJson(self::DRAFT, ['revision' => 0, 'settings' => []])->assertStatus(409)
            ->assertJsonPath('error.code', 'DRAFT_CONFLICT')
            ->assertJsonPath('error.details.revision', 1);
        $this->getJson(self::DRAFT)->assertJsonPath('data.draft_revision', 1)->assertJsonPath('data.settings.colors.primary', '#0f766e');

        // Validation of the new keys (and of the envelope).
        $invalid = [
            'revision' => ['settings' => []],
            'settings' => ['revision' => 1],
            'settings.colors.button' => ['revision' => 1, 'settings' => ['colors' => ['button' => 'red']]],
            'settings.colors.link' => ['revision' => 1, 'settings' => ['colors' => ['link' => null]]],
            'settings.colors.button_hover' => ['revision' => 1, 'settings' => ['colors' => ['button_hover' => '#12345']]],
            'settings.colors.button_foreground' => ['revision' => 1, 'settings' => ['colors' => ['button_foreground' => '#ffffff80']]],
            'settings.typography.body_size' => ['revision' => 1, 'settings' => ['typography' => ['body_size' => 21]]],
            'settings.typography.heading_scale' => ['revision' => 1, 'settings' => ['typography' => ['heading_scale' => 1.6]]],
            'settings.typography.line_height' => ['revision' => 1, 'settings' => ['typography' => ['line_height' => 1.2]]],
            'settings.typography.heading_weight' => ['revision' => 1, 'settings' => ['typography' => ['heading_weight' => 750]]],
            'settings.typography.mobile_scale' => ['revision' => 1, 'settings' => ['typography' => ['mobile_scale' => 1.1]]],
            'settings.typography.letter_spacing' => ['revision' => 1, 'settings' => ['typography' => ['letter_spacing' => -0.05]]],
            'settings.palette' => ['revision' => 1, 'settings' => ['palette' => array_fill(0, 9, ['name' => 'X', 'hex' => '#000000'])]],
            'settings.palette.0.hex' => ['revision' => 1, 'settings' => ['palette' => [['name' => 'X', 'hex' => 'black']]]],
            'settings.palette.0.name' => ['revision' => 1, 'settings' => ['palette' => [['hex' => '#000000']]]],
            'settings.palette.0' => ['revision' => 1, 'settings' => ['palette' => [['name' => 'X', 'hex' => '#000000', 'id' => 1]]]],
            'settings.layout.top_bar' => ['revision' => 1, 'settings' => ['layout' => ['top_bar' => 'banner']]],
            'settings.announcement.text' => ['revision' => 1, 'settings' => ['announcement' => ['enabled' => true]]],
        ];
        foreach ($invalid as $field => $body) {
            $this->putJson(self::DRAFT, $body)->assertStatus(422)->assertJsonValidationErrorFor($field, 'error.details');
        }
        // The same rules on the legacy endpoint.
        $this->putJson('/api/v1/storefront/theme', ['typography' => ['body_size' => 12]])->assertStatus(422)->assertJsonValidationErrorFor('typography.body_size', 'error.details');
        $this->putJson('/api/v1/storefront/theme', ['palette' => [['name' => 'X', 'hex' => '#00']]])->assertStatus(422)->assertJsonValidationErrorFor('palette.0.hex', 'error.details');

        // Media must exist.
        $this->putJson(self::DRAFT, ['revision' => 1, 'settings' => ['logo_media_id' => '01900000-0000-7000-8000-000000000001']])
            ->assertStatus(422)->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');
        $this->getJson(self::DRAFT)->assertJsonPath('data.draft_revision', 1);

        // Draft saves are not audited.
        $this->assertDatabaseMissing('audit_logs', ['action' => 'storefront.theme_updated']);
    }

    public function test_publish_discard_versions_and_restore(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $this->putJson('/api/v1/storefront/theme/custom-css', ['custom_css' => '.x{color:red}'])->assertOk();
        $original = $this->getJson('/api/v1/storefront/theme')->json('data.settings');
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->assertJsonPath('data.theme.colors.button', '#f59e0b');
        $this->actingAsUser($admin);

        $this->saveDraft(['colors' => ['primary' => '#0f766e', 'primary_foreground' => '#ffffff', 'button_hover' => '#0b5f58']]);
        Date::setTestNow('2026-11-11T11:00:00+06:00');

        // Publish: the first one records what was live before as version 1.
        $this->postJson('/api/v1/storefront/theme/publish', ['note' => '  Teal look  '])->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.has_unpublished_changes', false)
            ->assertJsonPath('data.published.number', 2)
            ->assertJsonPath('data.published.published_at', '2026-11-11T05:00:00+00:00')
            ->assertJsonPath('data.custom_css', '.x{color:red}');
        $live = $this->getJson('/api/v1/storefront/theme')->assertOk()
            ->assertJsonPath('data.settings.colors.primary', '#0f766e')
            // The button follows the draft's primary (it was never set on its own).
            ->assertJsonPath('data.settings.colors.button', '#0f766e')
            ->assertJsonPath('data.settings.colors.button_foreground', '#ffffff')
            ->assertJsonPath('data.settings.colors.button_hover', '#0b5f58')
            ->assertJsonPath('data.custom_css', '.x{color:red}')
            ->json('data.settings');
        $versions = $this->getJson('/api/v1/storefront/theme/versions')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.number', 2)
            ->assertJsonPath('data.0.note', 'Teal look')
            ->assertJsonPath('data.0.created_by.id', $admin->id)
            ->assertJsonPath('data.1.number', 1)
            ->assertJsonPath('data.1.note', ManageThemeDraft::FIRST_VERSION_NOTE)
            ->assertJsonPath('data.1.created_by', null)
            ->json('data');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_published']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_updated']);

        // The store gets the new theme (the cached bootstrap is replaced).
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.colors.button', '#0f766e')
            ->assertJsonPath('data.theme.colors.button_hover', '#0b5f58')
            ->assertJsonPath('data.theme.typography.body_size', 16);
        $this->actingAsUser($admin);

        // Discard: the draft goes back to the live theme.
        $this->saveDraft(['colors' => ['primary' => '#000000']]);
        $this->getJson(self::DRAFT)->assertJsonPath('data.has_unpublished_changes', true);
        $this->postJson('/api/v1/storefront/theme/discard')->assertOk()
            ->assertJsonPath('data.has_unpublished_changes', false)
            ->assertJsonPath('data.settings', $live)
            ->assertJsonPath('data.published.number', 2);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_draft_discarded']);

        // Restore version 1 into the draft; live only after publishing.
        $this->postJson("/api/v1/storefront/theme/versions/{$versions[1]['id']}/restore")->assertOk()
            ->assertJsonPath('data.settings', $original)
            ->assertJsonPath('data.has_unpublished_changes', true);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.theme_restored']);
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings', $live);
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk()->assertJsonPath('data.published.number', 3);
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings', $original);
        $this->getJson('/api/v1/storefront/theme/versions')->assertJsonCount(3, 'data')->assertJsonPath('data.0.note', null);

        // Unknown version ids are not found.
        $this->postJson('/api/v1/storefront/theme/versions/01900000-0000-7000-8000-000000000001/restore')->assertNotFound();
        $this->postJson('/api/v1/storefront/theme/versions/not-a-uuid/restore')->assertNotFound();
    }

    public function test_an_old_version_without_the_new_keys_restores_with_its_own_colours(): void
    {
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        // A version written before B3 (no button / link / type scale / palette).
        $old = ['colors' => ['primary' => '#123456', 'primary_foreground' => '#ffffff', 'accent' => '#2e7d32'], 'typography' => ['heading_font' => 'jost', 'body_font' => 'jost']];
        $versionId = $this->inTenant($org, function () use ($old) {
            $document = BuilderDocument::query()->where('key', 'theme')->firstOrFail();

            return $document->versions()->create(['number' => 9, 'schema_version' => 1, 'content' => $old, 'published_at' => now()])->id;
        });

        $this->postJson("/api/v1/storefront/theme/versions/{$versionId}/restore")->assertOk()
            ->assertJsonPath('data.settings', ThemeSchema::normalize($old))
            ->assertJsonPath('data.settings.colors.button', '#123456')
            ->assertJsonPath('data.settings.colors.link', '#2e7d32')
            ->assertJsonPath('data.settings.typography.body_size', 16);
    }

    public function test_a_theme_stored_before_b3_reads_the_same_plus_the_new_keys(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $stored = ThemePresets::all()['handmade'];
        $stored['colors'] = array_intersect_key($stored['colors'], array_flip(ThemeSchema::COLORS));
        $stored['typography'] = ['heading_font' => 'playfair', 'body_font' => 'jost'];
        $this->inTenant($org, fn () => ThemeSettings::query()->create(['settings' => $stored]));

        $settings = $this->getJson('/api/v1/storefront/theme')->assertOk()->json('data.settings');

        $this->assertSame(ThemePresets::theme('handmade'), $settings);
        $this->getJson(self::DRAFT)->assertJsonPath('data.settings', $settings)->assertJsonPath('data.has_unpublished_changes', false);
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.colors', $settings['colors'])
            ->assertJsonPath('data.theme.typography', $settings['typography']);
        $this->actingAsUser($admin);
    }

    public function test_the_legacy_put_saves_and_publishes(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->saveDraft(['colors' => ['primary' => '#000000']]);

        // The legacy save replaces the draft (no revision) and publishes it.
        $this->putJson('/api/v1/storefront/theme', ['colors' => ['primary' => '#abcdef'], 'palette' => [['name' => 'Sky', 'hex' => '#abcdef']]])->assertOk()
            ->assertJsonPath('data.settings.colors.primary', '#abcdef')
            ->assertJsonPath('data.settings.colors.button', '#abcdef')
            ->assertJsonPath('data.settings.palette.0.name', 'Sky');
        $this->getJson(self::DRAFT)->assertOk()
            ->assertJsonPath('data.draft_revision', 2)
            ->assertJsonPath('data.has_unpublished_changes', false)
            ->assertJsonPath('data.published.number', 2)
            ->assertJsonPath('data.settings.colors.primary', '#abcdef');
        $this->asVisitor();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.theme.colors.primary', '#abcdef');

        // It publishes, so it needs storefront.publish; the draft endpoints need storefront.manage.
        $editor = $this->role($org, 'Editor', ['storefront.view', 'storefront.manage']);
        $this->actingAsUser($editor);
        $this->putJson('/api/v1/storefront/theme', ['colors' => ['primary' => '#111111']])->assertForbidden();
        $this->saveDraft(['colors' => ['primary' => '#111111']]);
        $this->postJson('/api/v1/storefront/theme/presets/classic/apply')->assertOk()->assertJsonPath('data.settings.preset', 'classic');
        $this->postJson('/api/v1/storefront/theme/discard')->assertOk();
        $this->postJson('/api/v1/storefront/theme/publish')->assertForbidden();
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings.colors.primary', '#abcdef');

        $viewer = $this->role($org, 'Viewer', ['storefront.view']);
        $this->actingAsUser($viewer);
        $this->getJson(self::DRAFT)->assertOk();
        $this->getJson('/api/v1/storefront/theme/versions')->assertOk()->assertJsonCount(2, 'data');
        $versionId = $this->getJson('/api/v1/storefront/theme/versions')->json('data.1.id');
        $this->putJson(self::DRAFT, ['revision' => 3, 'settings' => []])->assertForbidden();
        $this->postJson('/api/v1/storefront/theme/discard')->assertForbidden();
        $this->postJson("/api/v1/storefront/theme/versions/{$versionId}/restore")->assertForbidden();
        $this->postJson('/api/v1/storefront/theme/publish')->assertForbidden();

        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson(self::DRAFT)->assertForbidden();
        $this->getJson('/api/v1/storefront/theme/versions')->assertForbidden();

        // The online store manager publishes.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $this->saveDraft(['colors' => ['primary' => '#222222']]);
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk()->assertJsonPath('data.published.number', 3)->assertJsonPath('data.custom_css', null);
        $this->actingAsUser($admin);
    }

    public function test_staff_preview_the_draft_theme_on_the_store_and_in_the_canvas(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->store('Berry Kids', 'berry.test');
        ['admin' => $otherAdmin] = $this->store('Tiny Toes', 'tiny.test');
        $this->actingAsUser($admin);
        $this->saveDraft(['colors' => ['primary' => '#0f766e', 'link' => '#1d4ed8'], 'typography' => ['body_size' => 18]]);

        // The staff member of the store sees the draft theme, never cached.
        $preview = $this->getJson('http://berry.test/api/v1/store/bootstrap?preview=draft')->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.theme_source', 'draft')
            ->assertJsonPath('data.theme.colors.primary', '#0f766e')
            ->assertJsonPath('data.theme.colors.button', '#0f766e')
            ->assertJsonPath('data.theme.colors.link', '#1d4ed8')
            ->assertJsonPath('data.theme.typography.body_size', 18);
        $this->assertNull($preview->headers->get('ETag'));
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.theme.colors.primary', '#f59e0b')
            ->assertJsonMissingPath('data.theme_source');

        // The canvas draws the draft theme.
        $this->getJson('/api/v1/storefront/builder/canvas-context')->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.theme_source', 'draft')
            ->assertJsonPath('data.bootstrap.theme.colors.primary', '#0f766e')
            ->assertJsonPath('data.bootstrap.theme.typography.body_size', 18);

        // The HTML shell inlines the draft theme for staff (noindex, no-store).
        $shell = tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $shell]);
        $page = $this->get('http://berry.test/?preview=draft')->assertOk()
            ->assertHeader('X-Robots-Tag', 'noindex');
        $this->assertStringContainsString('no-store', (string) $page->headers->get('Cache-Control'));
        $this->assertSame('#0f766e', $this->inlinedBootstrap((string) $page->getContent())['theme']['colors']['primary']);

        // Visitors, other stores' staff and staff without storefront.view get the live theme.
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        foreach (['visitor' => null, 'other store' => $otherAdmin, 'cashier' => $cashier] as $who => $user) {
            $user === null ? $this->asVisitor() : $this->actingAsUser($user);
            $this->getJson('http://berry.test/api/v1/store/bootstrap?preview=draft')->assertOk()
                ->assertJsonPath('data.theme.colors.primary', '#f59e0b')
                ->assertJsonMissingPath('data.theme_source');
            $html = (string) $this->get('http://berry.test/?preview=draft')->assertOk()->getContent();
            $this->assertSame('#f59e0b', $this->inlinedBootstrap($html)['theme']['colors']['primary'], $who);
        }
        @unlink($shell);

        // The other store's own canvas shows its own (live) theme.
        $this->actingAsUser($otherAdmin);
        $this->getJson('/api/v1/storefront/builder/canvas-context')->assertOk()
            ->assertJsonPath('data.bootstrap.store.name', 'Tiny Toes')
            ->assertJsonPath('data.bootstrap.theme.colors.primary', '#f59e0b');
    }

    public function test_tenant_isolation(): void
    {
        ['admin' => $berryAdmin] = $this->store('Berry Kids', 'berry.test');
        $this->saveDraft(['colors' => ['primary' => '#0f766e']]);
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->saveDraft(['colors' => ['primary' => '#000000']]);
        $berryVersion = $this->getJson('/api/v1/storefront/theme/versions')->json('data.0.id');
        $berryRevision = $this->getJson(self::DRAFT)->json('data.draft_revision');

        ['admin' => $tinyAdmin] = $this->store('Tiny Toes', 'tiny.test');
        $this->actingAsUser($tinyAdmin);
        $this->getJson(self::DRAFT)->assertOk()
            ->assertJsonPath('data.draft_revision', 0)
            ->assertJsonPath('data.published', null)
            ->assertJsonPath('data.settings.colors.primary', '#f59e0b');
        $this->getJson('/api/v1/storefront/theme/versions')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson("/api/v1/storefront/theme/versions/{$berryVersion}/restore")->assertNotFound();

        // Tiny's own draft, publish and preset never touch Berry's.
        $this->saveDraft(['colors' => ['primary' => '#abcdef']]);
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk();
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk()->assertJsonPath('data.published.number', 2);
        $this->postJson('/api/v1/storefront/theme/discard')->assertOk();
        $this->getJson('http://berry.test/api/v1/store/bootstrap?preview=draft')->assertOk()
            ->assertJsonPath('data.theme.colors.primary', '#0f766e')
            ->assertJsonMissingPath('data.theme_source');

        $this->actingAsUser($berryAdmin);
        $this->getJson(self::DRAFT)->assertOk()
            ->assertJsonPath('data.draft_revision', $berryRevision)
            ->assertJsonPath('data.settings.colors.primary', '#000000')
            ->assertJsonPath('data.published.number', 2);
        $this->getJson('/api/v1/storefront/theme')->assertJsonPath('data.settings.colors.primary', '#0f766e');
        $this->getJson('/api/v1/storefront/theme/versions')->assertJsonCount(2, 'data');
        $this->asVisitor();
        $this->getJson('http://tiny.test/api/v1/store/bootstrap')->assertJsonPath('data.theme.preset', 'vegan');
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertJsonPath('data.theme.preset', 'default');
    }

    public function test_the_theme_document_is_not_a_builder_page(): void
    {
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->saveDraft(['colors' => ['primary' => '#0f766e']]);
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $id = $this->inTenant($org, fn () => BuilderDocument::query()->where('key', 'theme')->value('id'));
        $this->assertNotNull($id);

        $docs = '/api/v1/storefront/builder/documents';
        $this->getJson($docs)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("{$docs}/{$id}")->assertNotFound();
        $this->putJson("{$docs}/{$id}/draft", ['revision' => 2, 'content' => ['schema_version' => 1, 'sections' => []]])->assertNotFound();
        $this->postJson("{$docs}/{$id}/publish")->assertNotFound();
        $this->getJson("{$docs}/{$id}/versions")->assertNotFound();
        $this->deleteJson("{$docs}/{$id}")->assertNotFound();
        // The page key space is unaffected.
        $this->postJson($docs, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated();
        $this->postJson($docs, ['kind' => 'theme', 'key' => 'theme', 'title' => 'Theme'])->assertStatus(422);
        $this->getJson($docs)->assertJsonCount(1, 'data');
    }

    /**
     * @return array<string, mixed>
     */
    private function inlinedBootstrap(string $html): array
    {
        $this->assertSame(1, preg_match('#<script id="storefront-bootstrap" type="application/json">(.*?)</script>#s', $html, $m));

        return json_decode(html_entity_decode($m[1]), true, flags: JSON_THROW_ON_ERROR);
    }

    private function storeUrl(string $host): string
    {
        return (parse_url((string) config('app.url'), PHP_URL_SCHEME) ?: 'https').'://'.$host;
    }
}
