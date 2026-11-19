<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B13: who sees a section or an element (`audience`: validated, district and campaign ids
 * checked per organization, in every payload with the campaigns' matches and the store's time
 * zone) and A/B tests (`experiments` + section `experiment`: validated, server-managed status,
 * start / stop / keep writing the draft with revisions, permissions, isolation and audit).
 */
class StoreBuilderB13Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

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
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private function section(string $id, array $extra = [], array $elementExtra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => [
            $elementExtra + ['id' => 'e'.$id, 'type' => 'heading', 'props' => ['text' => 'Hello '.$id, 'level' => 2]],
        ]]]];
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

    private function revision(string $id): int
    {
        return (int) $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');
    }

    private function staff(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Editor '.Str::random(4)]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    /**
     * @return array<string, mixed>
     */
    private function experiment(string $id = 'x_hero', array $extra = []): array
    {
        return $extra + ['id' => $id, 'name' => 'Hero test', 'goal' => 'orders', 'split' => 50];
    }

    public function test_audiences_are_validated_normalized_and_in_every_payload(): void
    {
        $campaign = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid', 'utm_campaign' => 'eid-sale'])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/marketing/short-links', ['code' => 'eid-fb', 'target_path' => '/', 'campaign_id' => $campaign])->assertCreated();
        $global = $this->create(['kind' => 'global', 'title' => 'Promo', 'context' => 'page']);
        $this->save($global, ['sections' => [$this->section('s_g')]])->assertOk();
        $this->postJson(self::DOCS."/{$global}/publish")->assertOk();

        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $sections = [
            $this->section('s_a', ['audience' => ['match' => 'any', 'rules' => [
                ['kind' => 'visitor', 'is' => 'new'],
                ['kind' => 'district', 'in' => [18, 10]],
                ['kind' => 'campaign', 'in' => [strtoupper($campaign)], 'utm_source' => [' Facebook ']],
            ]]], ['audience' => ['rules' => [
                ['kind' => 'device', 'in' => ['mobile', 'desktop']],
                ['kind' => 'cart', 'min' => '1500', 'max' => 5000],
                ['kind' => 'time', 'days' => ['sat', 'fri'], 'from' => '18:00', 'to' => '02:00'],
                ['kind' => 'language', 'in' => ['bn']],
                ['kind' => 'account', 'is' => 'signed_in'],
            ]]]),
            $this->section('s_b'),
            ['id' => 'g_1', 'type' => 'global_section', 'ref' => $global, 'audience' => ['rules' => [['kind' => 'visitor', 'is' => 'returning']]]],
        ];
        $content = $this->save($home, ['sections' => $sections])->assertOk()->json('data.content');
        $this->assertSame(['match' => 'any', 'otherwise' => 'hide', 'rules' => [
            ['kind' => 'visitor', 'is' => 'new'],
            ['kind' => 'district', 'in' => [10, 18]],
            ['kind' => 'campaign', 'in' => [$campaign], 'utm_source' => ['facebook'], 'utm_campaign' => []],
        ]], $this->sorted($content['sections'][0]['audience']));
        $this->assertSame(['match' => 'all', 'otherwise' => 'hide', 'rules' => [
            ['kind' => 'device', 'in' => ['desktop', 'mobile']],
            ['kind' => 'cart', 'min' => '1500.00', 'max' => '5000.00'],
            ['kind' => 'time', 'days' => ['fri', 'sat'], 'from' => '18:00', 'to' => '02:00'],
            ['kind' => 'language', 'in' => ['bn']],
            ['kind' => 'account', 'is' => 'signed_in'],
        ]], $this->sorted($content['sections'][0]['columns'][0]['elements'][0]['audience']));
        $this->assertArrayNotHasKey('audience', $content['sections'][1]);
        $this->assertArrayNotHasKey('experiments', $content);
        $this->assertSame('returning', $content['sections'][2]['audience']['rules'][0]['is']);

        // The draft render and the published page carry the rules, the campaigns' matches and the time zone.
        $timezone = $this->t['organization']->fresh()->timezone;
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame([$campaign => ['utm_campaign' => 'eid-sale', 'short_links' => ['eid-fb']]], $draft['audience_campaigns']);
        $this->assertSame($timezone, $draft['timezone']);
        $this->assertSame([], $draft['experiments']);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $live = $this->getJson(self::HOME)->assertOk()->json('data');
        $this->assertSame('any', $live['sections'][0]['audience']['match']);
        $this->assertSame(['desktop', 'mobile'], $live['sections'][0]['columns'][0]['elements'][0]['audience']['rules'][0]['in']);
        $this->assertSame('returning', $live['sections'][2]['audience']['rules'][0]['is'], 'The reference\'s audience goes with the global section.');
        $this->assertSame([$campaign => ['utm_campaign' => 'eid-sale', 'short_links' => ['eid-fb']]], $live['audience_campaigns']);
        $this->assertSame([$timezone, []], [$live['timezone'], $live['experiments']]);
        $this->assertSame($timezone, $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.store.timezone'));

        // Malformed rules: every problem with its path and code.
        $bad = [$this->section('s_a', ['audience' => ['match' => 'some', 'rules' => [
            ['kind' => 'weather'],
            ['kind' => 'device', 'in' => ['watch']],
            ['kind' => 'cart', 'min' => '900', 'max' => '100'],
            ['kind' => 'cart', 'min' => 12.5],
            ['kind' => 'time', 'from' => '18:00'],
            ['kind' => 'time', 'days' => ['someday']],
        ]]], ['audience' => ['rules' => array_fill(0, 7, ['kind' => 'visitor', 'is' => 'new'])]])];
        $errors = $this->save($home, ['sections' => $bad])->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID')->json('error.details.errors');
        $this->assertSame([
            ['sections.0.audience.match', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.audience.rules.0.kind', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.audience.rules.1.in', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.audience.rules.2.max', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.audience.rules.3.min', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.audience.rules.4.to', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.audience.rules.5.days', 's_a', 'AUDIENCE_INVALID'],
            ['sections.0.columns.0.elements.0.audience.rules', 'es_a', 'AUDIENCE_INVALID'],
        ], array_map(fn (array $e) => [$e['path'], $e['node_id'], $e['code']], $errors));
        $this->save($home, ['sections' => [$this->section('s_a', ['audience' => ['rules' => []]])]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.audience.rules');

        // Districts must exist; campaigns must be this organization's.
        $this->save($home, ['sections' => [$this->section('s_a', ['audience' => ['rules' => [['kind' => 'district', 'in' => [18, 999]]]]])]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.code', 'DISTRICT_NOT_FOUND')
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.audience.rules.0.in')
            ->assertJsonPath('error.details.errors.0.ids', [999]);
        $this->openStore('Tiny Shop', 'tiny.test');
        $theirs = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Theirs'])->assertCreated()->json('data.id');
        $this->actingAsUser($this->t['admin']);
        $this->save($home, ['sections' => [$this->section('s_a', [], ['audience' => ['rules' => [['kind' => 'campaign', 'in' => [$campaign, $theirs]]]]])]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.code', 'CAMPAIGN_NOT_FOUND')
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.0.audience.rules.0.in')
            ->assertJsonPath('error.details.errors.0.ids', [$theirs]);
        $this->save($home, ['sections' => [$this->section('s_a', [], ['audience' => ['rules' => [['kind' => 'campaign', 'utm_source' => [str_repeat('x', 101)]]]]])]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.columns.0.elements.0.audience.rules.0.utm_source');
    }

    public function test_experiments_are_validated_and_their_status_is_the_servers(): void
    {
        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $sections = [
            $this->section('s_top'),
            $this->section('s_a', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']]),
            $this->section('s_b', ['experiment' => ['id' => 'x_hero', 'arm' => 'B']]),
            $this->section('s_b2', ['experiment' => ['id' => 'x_hero', 'arm' => 'B']]),
        ];
        // A new test is a draft whatever is sent.
        $content = $this->save($home, ['sections' => $sections, 'experiments' => [
            $this->experiment('x_hero', ['status' => 'running', 'started_at' => '2026-11-01T00:00:00Z', 'winner' => 'B', 'split' => 30]),
        ]])->assertOk()->json('data.content');
        $this->assertEquals([[
            'id' => 'x_hero', 'name' => 'Hero test', 'status' => 'draft', 'goal' => 'orders', 'split' => 30,
            'started_at' => null, 'ended_at' => null, 'winner' => null,
        ]], $content['experiments']);
        $this->assertEquals(['id' => 'x_hero', 'arm' => 'B'], $content['sections'][3]['experiment']);
        $this->assertArrayNotHasKey('experiment', $content['sections'][0]);
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame('Hero test', $draft['experiments'][0]['name']);
        $this->assertEquals(['id' => 'x_hero', 'arm' => 'A'], $draft['sections'][1]['experiment']);

        $errorsOf = fn (array $content) => array_map(fn (array $e) => [$e['path'], $e['code'] ?? null], $this->save($home, $content)->assertUnprocessable()->json('error.details.errors'));
        // A section of a test that doesn't exist; versions apart; a bad split; a 4th test.
        $this->assertSame([['sections.1.experiment.id', 'EXPERIMENT_INVALID'], ['sections.2.experiment.id', 'EXPERIMENT_INVALID'], ['sections.3.experiment.id', 'EXPERIMENT_INVALID']], $errorsOf(['sections' => $sections, 'experiments' => [$this->experiment('x_other')]]));
        $this->assertSame([['sections.3.experiment', 'EXPERIMENT_INVALID']], $errorsOf(['sections' => [$sections[1], $sections[2], $sections[0], $sections[3]], 'experiments' => [$this->experiment()]]));
        $this->assertSame([['experiments.0.goal', 'EXPERIMENT_INVALID'], ['experiments.0.split', 'EXPERIMENT_INVALID']], array_slice($errorsOf(['sections' => $sections, 'experiments' => [$this->experiment('x_hero', ['split' => 95, 'goal' => 'likes'])]]), 0, 2));
        $this->assertSame([['experiments', 'EXPERIMENT_INVALID']], $errorsOf(['sections' => [], 'experiments' => [$this->experiment('x_1'), $this->experiment('x_2'), $this->experiment('x_3'), $this->experiment('x_4')]]));
        $many = [$this->section('s_1', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']]), $this->section('s_2', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']]),
            $this->section('s_3', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']]), $this->section('s_4', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']])];
        $this->assertSame([['sections.0.experiment', 'EXPERIMENT_INVALID']], $errorsOf(['sections' => $many, 'experiments' => [$this->experiment()]]));
        $this->assertSame([['sections.0.experiment.arm', 'EXPERIMENT_INVALID']], $errorsOf(['sections' => [$this->section('s_1', ['experiment' => ['id' => 'x_hero', 'arm' => 'C']])], 'experiments' => [$this->experiment()]]));

        // Not in the header or popups.
        $header = $this->create(['kind' => 'header', 'key' => 'header', 'title' => 'Header']);
        $this->assertSame([['sections.0.experiment', 'EXPERIMENT_INVALID'], ['experiments', 'EXPERIMENT_INVALID']], array_map(
            fn (array $e) => [$e['path'], $e['code']],
            $this->save($header, ['sections' => [$this->section('s_1', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']])], 'experiments' => [$this->experiment()]])->assertUnprocessable()->json('error.details.errors'),
        ));

        // Copying a test's section to another page: a plain section there.
        $landing = $this->create(['kind' => 'page', 'key' => 'landing:sale', 'title' => 'Sale']);
        $this->postJson('/api/v1/storefront/builder/sections/copy', ['section' => $content['sections'][2], 'document_ids' => [$landing], 'position' => 'top'])
            ->assertOk()->assertJsonPath('data.results.0.status', 'copied');
        $copied = $this->getJson(self::DOCS."/{$landing}")->json('data.content.sections.0');
        $this->assertArrayNotHasKey('experiment', $copied);
        // Saving it as a template too.
        $this->postJson('/api/v1/storefront/builder/templates', ['name' => 'Hero B', 'scope' => 'section', 'context' => 'page', 'section' => $content['sections'][2]])->assertCreated()
            ->assertJsonMissingPath('data.content.section.experiment');
    }

    public function test_tests_are_started_stopped_and_ended_in_the_draft(): void
    {
        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $a = $this->section('s_a', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']]);
        $b = $this->section('s_b', ['experiment' => ['id' => 'x_hero', 'arm' => 'B']]);
        $end = $this->section('s_end');
        $this->save($home, ['sections' => [$a, $end], 'experiments' => [$this->experiment()]])->assertOk();
        $url = self::DOCS."/{$home}/experiments/x_hero";

        $this->postJson("{$url}/start", ['revision' => 0])->assertStatus(409)->assertJsonPath('error.code', 'DRAFT_CONFLICT')->assertJsonPath('error.details.revision', 1);
        $this->postJson("{$url}/start", ['revision' => 1])->assertUnprocessable()->assertJsonPath('error.code', 'EXPERIMENT_NEEDS_BOTH_ARMS');
        $this->postJson("{$url}/start", [])->assertUnprocessable();
        $this->postJson(self::DOCS."/{$home}/experiments/x_none/start", ['revision' => 1])->assertNotFound()->assertJsonPath('error.code', 'EXPERIMENT_NOT_FOUND');

        $this->save($home, ['sections' => [$a, $b, $end], 'experiments' => [$this->experiment()]])->assertOk();
        $started = $this->postJson("{$url}/start", ['revision' => 2])->assertOk()->json('data');
        $this->assertSame(3, $started['draft_revision']);
        $this->assertSame(['running', null, null], [$started['content']['experiments'][0]['status'], $started['content']['experiments'][0]['ended_at'], $started['content']['experiments'][0]['winner']]);
        $this->assertNotNull($started['content']['experiments'][0]['started_at']);
        $this->postJson("{$url}/start", ['revision' => 3])->assertUnprocessable()->assertJsonPath('error.code', 'EXPERIMENT_STATUS');

        // The editor's save can't change the status; nor can it drop a running test's version.
        $this->save($home, ['sections' => [$a, $b, $end], 'experiments' => [$this->experiment('x_hero', ['status' => 'draft', 'split' => 20])]])->assertOk()
            ->assertJsonPath('data.content.experiments.0.status', 'running')->assertJsonPath('data.content.experiments.0.split', 20);
        $this->save($home, ['sections' => [$a, $end], 'experiments' => [$this->experiment()]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.path', 'experiments.0')->assertJsonPath('error.details.errors.0.code', 'EXPERIMENT_INVALID');

        // Published: shoppers' browsers get what they need to pick a version, and both versions.
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $live = $this->getJson(self::HOME)->assertOk()->json('data');
        $this->assertSame([['id' => 'x_hero', 'status' => 'running', 'split' => 20, 'winner' => null]], $live['experiments']);
        $this->assertSame(['s_a', 's_b', 's_end'], array_column($live['sections'], 'id'));
        $this->assertEquals(['id' => 'x_hero', 'arm' => 'B'], $live['sections'][1]['experiment']);

        $stopped = $this->postJson("{$url}/stop", ['revision' => $this->revision($home)])->assertOk()->json('data.content.experiments.0');
        $this->assertSame('stopped', $stopped['status']);
        $this->assertNotNull($stopped['ended_at']);
        $this->postJson("{$url}/stop", ['revision' => $this->revision($home)])->assertUnprocessable()->assertJsonPath('error.code', 'EXPERIMENT_STATUS');
        $this->postJson("{$url}/start", ['revision' => $this->revision($home)])->assertOk()->assertJsonPath('data.content.experiments.0.ended_at', null);

        $this->postJson("{$url}/keep", ['revision' => $this->revision($home), 'arm' => 'C'])->assertUnprocessable();
        $kept = $this->postJson("{$url}/keep", ['revision' => $this->revision($home), 'arm' => 'B'])->assertOk()->json('data.content');
        $this->assertSame(['s_b', 's_end'], array_column($kept['sections'], 'id'));
        $this->assertArrayNotHasKey('experiment', $kept['sections'][0]);
        $this->assertSame(['ended', 'B'], [$kept['experiments'][0]['status'], $kept['experiments'][0]['winner']]);
        $this->assertNotNull($kept['experiments'][0]['ended_at']);
        $this->postJson("{$url}/keep", ['revision' => $this->revision($home), 'arm' => 'A'])->assertUnprocessable()->assertJsonPath('error.code', 'EXPERIMENT_STATUS');
        // Live until published.
        $this->assertSame('running', $this->getJson(self::HOME)->json('data.experiments.0.status'));

        $this->assertSame([2, 1, 1], [
            DB::table('audit_logs')->where('action', 'storefront.builder_experiment_started')->count(),
            DB::table('audit_logs')->where('action', 'storefront.builder_experiment_stopped')->count(),
            DB::table('audit_logs')->where('action', 'storefront.builder_experiment_kept')->count(),
        ]);
    }

    public function test_test_actions_need_publishing_rights_and_stay_in_the_organization(): void
    {
        $home = $this->create(['kind' => 'page', 'key' => 'home', 'title' => 'Home']);
        $this->save($home, ['sections' => [
            $this->section('s_a', ['experiment' => ['id' => 'x_hero', 'arm' => 'A']]),
            $this->section('s_b', ['experiment' => ['id' => 'x_hero', 'arm' => 'B']]),
        ], 'experiments' => [$this->experiment()]])->assertOk();
        $url = self::DOCS."/{$home}/experiments/x_hero";

        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage']));
        $this->postJson("{$url}/start", ['revision' => 1])->assertForbidden();
        $this->postJson("{$url}/keep", ['revision' => 1, 'arm' => 'A'])->assertForbidden();

        $this->openStore('Tiny Shop', 'tiny.test');
        $this->postJson("{$url}/start", ['revision' => 1])->assertNotFound();

        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage', 'storefront.publish']));
        $this->postJson("{$url}/start", ['revision' => 1])->assertOk();
        $this->assertSame(0, DB::table('audit_logs')->where('action', 'storefront.builder_experiment_started')->where('organization_id', '!=', $this->t['organization']->id)->count());
    }

    /**
     * An audience with its keys in canonical order (jsonb sorts keys on storage).
     *
     * @param  array<string, mixed>  $audience
     * @return array<string, mixed>
     */
    private function sorted(array $audience): array
    {
        $order = ['kind', 'is', 'in', 'utm_source', 'utm_campaign', 'min', 'max', 'days', 'from', 'to'];
        $audience['rules'] = array_map(function (array $rule) use ($order) {
            uksort($rule, fn ($a, $b) => array_search($a, $order, true) <=> array_search($b, $order, true));

            return $rule;
        }, $audience['rules']);

        return ['match' => $audience['match'], 'otherwise' => $audience['otherwise'], 'rules' => $audience['rules']];
    }
}
