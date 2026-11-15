<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B12: the order on tablets and phones (`device_order`: saved, published, in every render payload
 * with global sections' own orders merged, compared per device) and copying a section into the
 * drafts of several documents (validation per target, permissions, isolation, audit).
 */
class StoreBuilderB12Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const COPY = '/api/v1/storefront/builder/sections/copy';

    private const HOME = 'http://berry.test/api/v1/store/builder/pages/home';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     */
    private function section(string $id, array $elements, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => $elements]]];
    }

    private function heading(string $id, string $text = 'Hello', array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'heading', 'props' => ['text' => $text, 'level' => 2]];
    }

    private function create(array $attributes): string
    {
        return $this->postJson(self::DOCS, $attributes)->assertCreated()->json('data.id');
    }

    private function save(string $id, array $content): TestResponse
    {
        $current = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $current['draft_revision'], 'content' => ['schema_version' => 1] + $content]);
    }

    private function staff(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Editor']);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    public function test_device_order_is_saved_published_rendered_and_compared(): void
    {
        // A global section with its own phone order.
        $global = $this->create(['kind' => 'global', 'title' => 'Promo', 'context' => 'page']);
        $this->save($global, [
            'sections' => [$this->section('s_g', [$this->heading('e_g1', 'One'), $this->heading('e_g2', 'Two')])],
            'device_order' => ['mobile' => ['cs_g' => ['e_g2', 'e_g1']], 'tablet' => ['root' => ['s_g']]],
        ])->assertOk()->assertJsonPath('data.content.device_order', ['mobile' => ['cs_g' => ['e_g2', 'e_g1']]]);
        $this->postJson(self::DOCS."/{$global}/publish")->assertOk();

        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $sections = [
            $this->section('s_a', [$this->heading('e_1'), $this->heading('e_2', 'Hidden', ['hidden' => true]), $this->heading('e_3')]),
            $this->section('s_b', [$this->heading('e_4')]),
            ['id' => 'g_1', 'type' => 'global_section', 'ref' => $global],
        ];
        $saved = $this->save($home, ['sections' => $sections, 'device_order' => [
            'tablet' => ['root' => ['g_1', 's_b', 's_a'], 'c_gone' => ['e_1', 'e_3']],
            'mobile' => ['cs_a' => ['e_3', 'e_new', 'e_2']],
        ]])->assertOk()->json('data.content');
        $this->assertSame([
            'tablet' => ['root' => ['g_1', 's_b', 's_a']],
            'mobile' => ['cs_a' => ['e_3', 'e_2', 'e_1']],
        ], $saved['device_order']);
        // Read back in document order (jsonb sorts keys).
        $this->assertSame($saved['device_order'], $this->getJson(self::DOCS."/{$home}")->json('data.content.device_order'));

        // Malformed: 422 with the path and code.
        $this->save($home, ['sections' => $sections, 'device_order' => ['mobile' => ['cs_a' => ['e_1', 'e_1']]]])->assertUnprocessable()
            ->assertJsonPath('error.code', 'DOCUMENT_INVALID')
            ->assertJsonPath('error.details.errors.0.path', 'device_order.mobile.cs_a')
            ->assertJsonPath('error.details.errors.0.node_id', 'cs_a')
            ->assertJsonPath('error.details.errors.0.code', 'DEVICE_ORDER_INVALID');

        // The draft render keeps hidden nodes; the global's order is merged in.
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data.device_order');
        $this->assertSame([
            'tablet' => ['root' => ['g_1', 's_b', 's_a']],
            'mobile' => ['cs_a' => ['e_3', 'e_2', 'e_1'], 'cs_g' => ['e_g2', 'e_g1']],
        ], $draft);

        // Published: only what visitors see.
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $live = $this->getJson(self::HOME)->assertOk()->json('data');
        $this->assertSame([
            'tablet' => ['root' => ['g_1', 's_b', 's_a']],
            'mobile' => ['cs_a' => ['e_3', 'e_1'], 'cs_g' => ['e_g2', 'e_g1']],
        ], $live['device_order']);
        $this->assertSame(['s_a', 's_b', 'g_1'], array_column($live['sections'], 'id'), 'The base order is unchanged.');

        // Compare: a phone move is reported with its device; the desktop order didn't change.
        $this->save($home, ['sections' => $sections, 'device_order' => [
            'tablet' => ['root' => ['g_1', 's_b', 's_a']],
            'mobile' => ['cs_a' => ['e_1', 'e_2', 'e_3'], 'root' => ['s_a', 'g_1', 's_b']],
        ]])->assertOk();
        $diff = $this->getJson(self::DOCS."/{$home}/compare")->assertOk()->json('data');
        $this->assertSame([], $diff['moved']);
        $this->assertSame([], $diff['changed']);
        // The phone's own root order (it followed the tablet before) and its element order going back
        // to the desktop one (an order equal to what it inherits is not stored).
        $this->assertSame([['id' => 's_a', 'device' => 'mobile'], ['id' => 'e_2', 'device' => 'mobile'], ['id' => 'e_3', 'device' => 'mobile']], $diff['device_moved']);

        // A page without an order of its own has none in the payload.
        $landing = $this->create(['kind' => 'page', 'key' => 'landing:sale', 'title' => 'Sale']);
        $this->save($landing, ['sections' => [$this->section('s_x', [$this->heading('e_x')])]])->assertOk()->assertJsonMissingPath('data.content.device_order');
        $this->assertNull($this->getJson(self::DOCS."/{$landing}/render")->assertOk()->json('data.device_order'));
    }

    public function test_popups_and_the_header_carry_their_order(): void
    {
        $popup = $this->create(['kind' => 'popup', 'title' => 'Welcome']);
        $content = $this->getJson(self::DOCS."/{$popup}")->assertOk()->json('data.content');
        $this->save($popup, ['popup' => $content['popup'], 'sections' => [$this->section('s_p', [$this->heading('e_p1'), $this->heading('e_p2')])],
            'device_order' => ['mobile' => ['cs_p' => ['e_p2', 'e_p1']]]])->assertOk();
        $this->getJson("http://berry.test/api/v1/store/builder/popups?preview=draft&popup={$popup}")->assertOk()
            ->assertJsonPath('data.popups.0.payload.device_order', ['mobile' => ['cs_p' => ['e_p2', 'e_p1']]]);

        $header = $this->create(['kind' => 'header', 'key' => 'header', 'title' => 'Header']);
        $this->save($header, ['sections' => [$this->section('s_h1', [$this->heading('e_h1')]), $this->section('s_h2', [$this->heading('e_h2')])],
            'device_order' => ['tablet' => ['root' => ['s_h2', 's_h1']]]])->assertOk();
        $this->postJson(self::DOCS."/{$header}/publish")->assertOk();
        $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()
            ->assertJsonPath('data.builder.header.device_order', ['tablet' => ['root' => ['s_h2', 's_h1']]]);
    }

    public function test_a_section_is_copied_into_several_drafts(): void
    {
        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $this->save($home, ['sections' => [
            $this->section('s_1', [$this->heading('e_1')], ['props' => ['sticky' => true]]),
            $this->section('s_2', [$this->heading('e_2')]),
        ], 'device_order' => ['tablet' => ['root' => ['s_2', 's_1']]]])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $landing = $this->create(['kind' => 'page', 'key' => 'landing:sale', 'title' => 'Sale']);
        $header = $this->create(['kind' => 'header', 'key' => 'header', 'title' => 'Header']);
        $popup = $this->create(['kind' => 'popup', 'title' => 'Welcome']);
        $global = $this->create(['kind' => 'global', 'title' => 'Band', 'context' => 'page']);
        $full = $this->create(['kind' => 'page', 'key' => 'landing:full', 'title' => 'Full']);
        $this->save($full, ['sections' => array_map(fn (int $i) => $this->section("s_f{$i}", []), range(1, 60))])->assertOk();
        $missing = '01900000-0000-7000-8000-00000000abcd';

        $section = $this->section('s_promo', [
            $this->heading('e_title', 'Big sale'),
            ['id' => 'e_close', 'type' => 'button', 'props' => ['label' => 'Close', 'link' => ['url' => '/'], 'action' => 'dismiss']],
            ['id' => 'e_cta', 'type' => 'cta', 'props' => ['title' => 'Shop now', 'primary' => ['label' => 'Go', 'link' => ['url' => '/shop']]]],
        ], ['props' => ['anchor' => 'promo', 'sticky' => true]]);

        $results = $this->postJson(self::COPY, ['section' => $section, 'document_ids' => [$home, $landing, $header, $popup, $global, $full, $missing], 'position' => 'top'])
            ->assertOk()->json('data.results');
        $this->assertSame([$home, $landing, $header, $popup, $global, $full, $missing], array_column($results, 'document_id'));
        $this->assertSame(['copied', 'copied', 'failed', 'failed', 'failed', 'failed', 'failed'], array_column($results, 'status'));
        $this->assertSame(['Home', 'Sale', 'Header', 'Welcome', 'Band', 'Full', null], array_column($results, 'title'));
        $this->assertSame('ELEMENT_NOT_ALLOWED', $results[2]['error']['errors'][0]['code']);
        $this->assertSame('DOCUMENT_INVALID', $results[2]['error']['code']);
        $this->assertSame(['TARGET_NOT_SUPPORTED', 'TARGET_NOT_SUPPORTED', 'DOCUMENT_INVALID', 'DOCUMENT_NOT_FOUND'], array_column(array_column(array_slice($results, 3), 'error'), 'code'));
        $this->assertSame(2, $results[0]['revision']);

        // Home: first, with new ids, no anchor, no second sticky section, the close button links again.
        $draft = $this->getJson(self::DOCS."/{$home}")->json('data.content');
        $copy = $draft['sections'][0];
        $this->assertSame($results[0]['section_id'], $copy['id']);
        $this->assertMatchesRegularExpression('/^s_[a-z0-9]{6}$/', $copy['id']);
        $this->assertMatchesRegularExpression('/^cs_[a-z0-9]{6}$/', $copy['columns'][0]['id']);
        $this->assertNotContains('e_title', array_column($copy['columns'][0]['elements'], 'id'));
        $this->assertSame(['Big sale', null, false], [$copy['columns'][0]['elements'][0]['props']['text'], $copy['props']['anchor'], $copy['props']['sticky'] ?? false]);
        $this->assertArrayNotHasKey('action', $copy['columns'][0]['elements'][1]['props']);
        $this->assertSame([$copy['id'], 's_2', 's_1'], $draft['device_order']['tablet']['root'], 'First on tablets too.');
        // The landing page has no sticky section, so the copy sticks there; still never published.
        $this->assertTrue($this->getJson(self::DOCS."/{$landing}")->json('data.content.sections.0.props.sticky'));
        $this->assertSame(['s_1', 's_2'], array_column($this->getJson(self::HOME)->assertOk()->json('data.sections'), 'id'));
        $this->assertNull($this->getJson(self::DOCS."/{$landing}")->json('data.published'));
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'storefront.builder_section_copied')->count());

        // Bottom: last.
        $bottom = $this->postJson(self::COPY, ['section' => $section, 'document_ids' => [$landing], 'position' => 'bottom'])->assertOk()->json('data.results.0');
        $sections = $this->getJson(self::DOCS."/{$landing}")->json('data.content.sections');
        $this->assertSame([2, $bottom['section_id']], [count($sections), $sections[1]['id']]);
    }

    public function test_copying_global_sections_custom_html_permissions_and_isolation(): void
    {
        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $header = $this->create(['kind' => 'header', 'key' => 'header', 'title' => 'Header']);
        $bar = $this->create(['kind' => 'global', 'title' => 'Top bar', 'context' => 'header']);
        $ref = ['id' => 'g_bar', 'type' => 'global_section', 'ref' => $bar];

        $results = $this->postJson(self::COPY, ['section' => $ref, 'document_ids' => [$home, $header], 'position' => 'bottom'])->assertOk()->json('data.results');
        $this->assertSame(['failed', 'copied'], array_column($results, 'status'));
        $this->assertSame('GLOBAL_CONTEXT_MISMATCH', $results[0]['error']['errors'][0]['code']);
        $copied = $this->getJson(self::DOCS."/{$header}")->json('data.content.sections.0');
        $this->assertSame(['global_section', $bar], [$copied['type'], $copied['ref']]);
        $this->assertNotSame('g_bar', $copied['id']);

        // Custom HTML: the whole request is refused without the permission.
        $html = $this->section('s_html', [['id' => 'e_html', 'type' => 'custom_html', 'props' => ['html' => '<p>Raw</p>']]]);
        $this->actingAsUser($this->createUserWithRole($this->t['organization'], SystemRole::OnlineStoreManager));
        $this->postJson(self::COPY, ['section' => $html, 'document_ids' => [$home], 'position' => 'top'])->assertForbidden()
            ->assertJsonPath('error.code', 'CUSTOM_HTML_FORBIDDEN')
            ->assertJsonPath('error.details.errors.0.path', 'section.columns.0.elements.0');
        $this->assertSame(0, $this->getJson(self::DOCS."/{$home}")->json('data.draft_revision'));
        $this->actingAsUser($this->t['admin']);
        $this->postJson(self::COPY, ['section' => $html, 'document_ids' => [$home], 'position' => 'top'])->assertOk()->assertJsonPath('data.results.0.status', 'copied');

        // Viewers can't copy.
        $this->actingAsUser($this->staff(['storefront.view']));
        $this->postJson(self::COPY, ['section' => $html, 'document_ids' => [$home], 'position' => 'top'])->assertForbidden();
        $this->actingAsUser($this->t['admin']);

        // Envelope validation.
        $ids = array_map(fn (int $i) => sprintf('01900000-0000-7000-8000-%012d', $i), range(1, 21));
        $this->postJson(self::COPY, ['section' => $html, 'document_ids' => $ids, 'position' => 'top'])->assertUnprocessable()->assertJsonValidationErrors('document_ids', 'error.details');
        $this->postJson(self::COPY, ['section' => $html, 'document_ids' => [$home, strtoupper($home)], 'position' => 'top'])->assertUnprocessable()->assertJsonValidationErrors('document_ids.0', 'error.details');
        $this->postJson(self::COPY, ['section' => $html, 'document_ids' => [$home], 'position' => 'middle'])->assertUnprocessable()->assertJsonValidationErrors('position', 'error.details');
        $this->postJson(self::COPY, ['section' => ['id' => 'c_1', 'type' => 'column'], 'document_ids' => [$home], 'position' => 'top'])->assertUnprocessable()->assertJsonValidationErrors('section.type', 'error.details');
        $this->postJson(self::COPY, ['document_ids' => [$home], 'position' => 'top'])->assertUnprocessable()->assertJsonValidationErrors('section', 'error.details');

        // Another organization's documents read as missing, and theirs stay untouched.
        $revision = BuilderDocument::query()->withoutGlobalScopes()->whereKey($home)->value('draft_revision');
        $this->openStore('Tiny Shop', 'tiny.test');
        $theirs = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Their home']);
        $this->postJson(self::COPY, ['section' => $this->section('s_x', [$this->heading('e_x')]), 'document_ids' => [$home, $theirs], 'position' => 'top'])->assertOk()
            ->assertJsonPath('data.results.0', ['document_id' => $home, 'title' => null, 'status' => 'failed', 'error' => ['code' => 'DOCUMENT_NOT_FOUND', 'message' => 'This page no longer exists.']])
            ->assertJsonPath('data.results.1.status', 'copied');
        $this->assertSame($revision, BuilderDocument::query()->withoutGlobalScopes()->whereKey($home)->value('draft_revision'));
    }
}
