<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B9: global sections (create, reference, render published / draft, cache, usage, delete rules,
 * isolation), the AI writer (gate, budget, metering, clamping, sanitizing, no text in the audit)
 * and page search & sharing settings (render payload and HTML shell).
 */
class StoreBuilderB9Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const GLOBALS = '/api/v1/storefront/builder/globals';

    private const WRITE = '/api/v1/storefront/builder/ai/write';

    private const HOME = 'http://berry.test/api/v1/store/builder/pages/home';

    /** @var array<string, mixed> */
    private array $t;

    private string $shell;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        $this->shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($this->shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $this->shell]);
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    protected function tearDown(): void
    {
        @unlink($this->shell);
        parent::tearDown();
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private function section(string $id, array $elements, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'section', 'columns' => [['id' => 'c'.$id, 'width' => ['base' => 100], 'elements' => $elements]]];
    }

    private function heading(string $id, string $text, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'heading', 'props' => ['text' => $text, 'level' => 2]];
    }

    private function save(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1] + $content]);
    }

    private function global(string $title, string $context, ?array $section = null): TestResponse
    {
        return $this->postJson(self::DOCS, ['kind' => 'global', 'title' => $title, 'context' => $context] + ($section === null ? [] : ['from' => 'section', 'section' => $section]));
    }

    private function ref(string $id, string $globalId, array $extra = []): array
    {
        return $extra + ['id' => $id, 'type' => 'global_section', 'ref' => $globalId];
    }

    public function test_global_sections_render_everywhere_and_follow_their_published_version(): void
    {
        $blank = $this->global('Empty band', 'page')->assertCreated()->json('data');
        $this->assertSame(['global', 'page', 1, 0], [$blank['kind'], $blank['context'], count($blank['content']['sections']), $blank['global']['usage_count']]);
        $this->assertMatchesRegularExpression('/^global:[0-9a-f-]{36}$/', $blank['key']);
        $this->assertSame([], $blank['content']['sections'][0]['columns'][0]['elements']);

        $promo = $this->global('Promo strip', 'page', $this->section('s_promo', [$this->heading('e_promo', 'Free delivery today', ['translations' => ['bn' => ['text' => 'আজ ফ্রি ডেলিভারি']]])]))
            ->assertCreated()->json('data');
        $this->assertSame('s_promo', $promo['content']['sections'][0]['id']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_created']);

        // A home page uses it (and the empty one) before the global is published.
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($home, ['sections' => [
            $this->ref('g_top', $promo['id']),
            $this->section('s_main', [$this->heading('e_main', 'Welcome')]),
            $this->ref('g_later', $promo['id'], ['hidden' => true]),
        ]])->assertOk()->assertJsonPath('data.content.sections.0', ['id' => 'g_top', 'type' => 'global_section', 'ref' => $promo['id'], 'hidden' => false, 'schedule' => null]);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        // Published: the unpublished global is left out; the draft shows its draft.
        $this->assertSame(['s_main'], array_column($this->getJson(self::HOME)->assertOk()->json('data.sections'), 'id'));
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data.sections');
        $this->assertSame(['g_top', 's_main', 'g_later'], array_column($draft, 'id'));
        $this->assertSame(['section', ['id' => $promo['id'], 'title' => 'Promo strip', 'section_id' => 's_promo', 'version' => null]], [$draft[0]['type'], $draft[0]['global']]);
        $this->assertSame('Free delivery today', $draft[0]['columns'][0]['elements'][0]['props']['text']);
        $this->assertSame('hidden', $draft[2]['state']);

        // Publishing the global updates every page that shows it (cache refreshed).
        $this->postJson(self::DOCS."/{$promo['id']}/publish")->assertOk();
        $live = $this->getJson(self::HOME)->assertOk()->json('data.sections');
        $this->assertSame(['g_top', 's_main'], array_column($live, 'id'));
        $this->assertSame(1, $live[0]['global']['version']);
        $this->assertSame('আজ ফ্রি ডেলিভারি', $this->getJson(self::HOME.'?lang=bn')->json('data.sections.0.columns.0.elements.0.props.text'));
        $this->save($promo['id'], ['sections' => [$this->section('s_promo', [$this->heading('e_promo', 'Eid delivery is free')])]])->assertOk();
        $this->assertSame('Free delivery today', $this->getJson(self::HOME)->json('data.sections.0.columns.0.elements.0.props.text'), 'Drafts of a global are not live.');
        $this->postJson(self::DOCS."/{$promo['id']}/publish")->assertOk();
        $this->assertSame('Eid delivery is free', $this->getJson(self::HOME)->json('data.sections.0.columns.0.elements.0.props.text'));

        // Usage, the globals list (not in the documents index) and delete rules.
        $list = $this->getJson(self::GLOBALS)->assertOk()->json('data');
        $this->assertSame(['Empty band', 'Promo strip'], array_column($list, 'title'));
        $this->assertSame([0, 1], array_column($list, 'usage_count'));
        $this->assertSame([['id' => $home, 'title' => 'Home', 'kind' => 'page', 'key' => 'home']], $list[1]['used_in']);
        $this->assertNotContains($promo['id'], array_column($this->getJson(self::DOCS)->json('data'), 'id'));
        $this->assertSame(1, $this->getJson(self::DOCS."/{$promo['id']}")->assertOk()->json('data.global.usage_count'));
        $this->deleteJson(self::DOCS."/{$promo['id']}")->assertStatus(409)
            ->assertJsonPath('error.code', 'GLOBAL_IN_USE')
            ->assertJsonPath('error.details.used_in.0.id', $home);
        $this->deleteJson(self::DOCS."/{$blank['id']}")->assertNoContent();

        // Removing it from the draft still leaves the live version using it.
        $this->save($home, ['sections' => [$this->section('s_main', [$this->heading('e_main', 'Welcome')])]])->assertOk();
        $this->deleteJson(self::DOCS."/{$promo['id']}")->assertStatus(409);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->deleteJson(self::DOCS."/{$promo['id']}")->assertNoContent();
    }

    public function test_global_sections_fit_their_context_and_stay_in_their_organization(): void
    {
        $header = $this->global('Top bar', 'header', $this->section('s_bar', [$this->heading('e_bar', 'Call us')]))->assertCreated()->json('data.id');
        $page = $this->global('Promo', 'page')->assertCreated()->json('data.id');
        $this->global('Bad', 'sidebar')->assertUnprocessable()->assertJsonValidationErrors(['context'], 'error.details');
        $this->global('Bad', 'page', ['id' => 's_bad', 'type' => 'section', 'columns' => [['id' => 'c_bad', 'width' => ['base' => 100], 'elements' => [['id' => 'e_logo', 'type' => 'logo']]]]])
            ->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'ELEMENT_NOT_ALLOWED');
        $this->global('Bad', 'page', $this->ref('g_x', $page))->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'GLOBAL_NOT_ALLOWED');

        $landing = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid'])->assertCreated()->json('data.id');
        $this->save($landing, ['sections' => [$this->ref('g_bar', $header)]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.code', 'GLOBAL_CONTEXT_MISMATCH')
            ->assertJsonPath('error.details.errors.0.path', 'sections.0.ref');
        $this->save($landing, ['sections' => [$this->ref('g_promo', $page)]])->assertOk();

        // The header shows a header global (the bootstrap carries it once both are published).
        $doc = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header'])->assertCreated()->json('data.id');
        $this->save($doc, ['sections' => [$this->ref('g_promo', $page)]])->assertUnprocessable()->assertJsonPath('error.details.errors.0.code', 'GLOBAL_CONTEXT_MISMATCH');
        $this->save($doc, ['sections' => [$this->ref('g_bar', $header)]])->assertOk();
        $this->postJson(self::DOCS."/{$doc}/publish")->assertOk();
        $this->postJson(self::DOCS."/{$header}/publish")->assertOk();
        $bootstrap = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.builder.header.sections');
        $this->assertSame(['g_bar', 'Call us'], [$bootstrap[0]['id'], $bootstrap[0]['columns'][0]['elements'][0]['props']['text']]);

        // Another organization neither sees, uses nor deletes these globals.
        $this->openStore('Tiny Shop', 'tiny.test');
        $this->assertSame([], $this->getJson(self::GLOBALS)->assertOk()->json('data'));
        $this->getJson(self::DOCS."/{$header}")->assertNotFound();
        $this->deleteJson(self::DOCS."/{$page}")->assertNotFound();
        $theirs = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($theirs, ['sections' => [$this->ref('g_promo', $page)]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.code', 'GLOBAL_NOT_FOUND')
            ->assertJsonPath('error.details.errors.0.ids', [$page]);
        $this->postJson(self::WRITE, ['mode' => 'element', 'document_id' => $landing, 'node_id' => 'g_promo', 'language' => 'en'])->assertNotFound();
    }

    public function test_a_missing_global_is_unavailable_in_the_draft_and_dropped_publicly(): void
    {
        $page = $this->global('Promo', 'page', $this->section('s_p', [$this->heading('e_p', 'Promo')]))->json('data.id');
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->json('data.id');
        $this->save($home, ['sections' => [$this->ref('g_p', $page), $this->section('s_main', [$this->heading('e_main', 'Hi')])]])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        // Gone from the database behind the API's back (e.g. a restored old version).
        DB::table('builder_documents')->where('id', $page)->delete();

        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data.sections.0');
        $this->assertSame(['g_p', 'global_section', 'unavailable', ['id' => $page, 'title' => null, 'section_id' => null, 'version' => null]], [$draft['id'], $draft['type'], $draft['state'], $draft['global']]);
        $this->assertSame(['s_main'], array_column($this->getJson(self::HOME)->json('data.sections'), 'id'));
    }

    public function test_ai_writer_is_gated_metered_and_clamped(): void
    {
        $page = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid'])->json('data.id');
        $this->save($page, ['sections' => [$this->section('s_main', [
            $this->heading('e_title', 'Eid sale'),
            ['id' => 'e_text', 'type' => 'text', 'props' => ['html' => '<p>Big savings.</p>']],
            ['id' => 'e_btn', 'type' => 'button', 'props' => ['label' => 'Shop', 'link' => ['url' => '/shop']]],
            ['id' => 'e_html', 'type' => 'custom_html', 'props' => ['html' => '<p>Raw</p>']],
        ])]])->assertOk();
        $request = ['mode' => 'element', 'document_id' => $page, 'node_id' => 'e_title', 'language' => 'en', 'tone' => 'festive'];

        // AI off: 422 with the reason, nothing logged.
        $this->postJson(self::WRITE, $request)->assertStatus(422)->assertJsonPath('error.code', 'AI_UNAVAILABLE')->assertJsonPath('error.details.reason', 'disabled');
        $this->postJson(self::WRITE, ['mode' => 'poem', 'language' => 'fr', 'tone' => 'angry', 'instruction' => str_repeat('a', 501)])->assertUnprocessable()
            ->assertJsonValidationErrors(['mode', 'document_id', 'node_id', 'language', 'tone', 'instruction'], 'error.details');

        $fake = $this->fakeAi();
        $fake->answer('```json'."\n".json_encode(['texts' => ['e_title::text' => '<b>'.str_repeat('Eid Mubarak! ', 30).'</b>', 'e_title::other' => 'x']])."\n```", 200, 50);
        $data = $this->postJson(self::WRITE, $request + ['instruction' => 'Mention free gift wrap', 'current' => ['text' => 'Eid deals']])->assertOk()->json('data');
        $this->assertSame(['ai', 'element', 'en', 'base'], [$data['source'], $data['mode'], $data['language'], $data['target']]);
        $this->assertSame(['text'], array_keys($data['texts']));
        $this->assertSame(200, mb_strlen($data['texts']['text']), 'Clamped to the heading limit, markup removed.');
        $this->assertStringNotContainsString('<b>', $data['texts']['text']);
        $this->assertSame(['e_title' => $data['texts']], $data['elements']);
        /** @var Message $message */
        $message = $fake->requests[0]['conversation']->messages[0];
        $this->assertStringContainsString('"current":"Eid deals"', $message->text());
        $this->assertStringContainsString('Mention free gift wrap', $message->text());
        $this->assertStringContainsString('"store":"Berry Kids"', $message->text());
        $this->assertStringContainsString('festive', $fake->requests[0]['conversation']->system);
        $row = DB::table('ai_requests')->first();
        $this->assertSame(['builder_writer', 'ok', 200, 50], [$row->feature, $row->status, (int) $row->input_tokens, (int) $row->output_tokens]);
        $audit = DB::table('audit_logs')->where('action', 'storefront.builder_ai_written')->first();
        $this->assertNotNull($audit);
        $this->assertStringNotContainsString('Eid Mubarak', json_encode($audit));
        $this->assertEquals(['mode' => 'element', 'language' => 'en', 'fields' => 1], array_intersect_key(json_decode((string) $audit->context, true), array_flip(['mode', 'language', 'fields'])));

        // A whole section in Bangla: every text field but custom HTML; HTML is sanitized.
        $fake->answer(json_encode(['texts' => [
            'e_title::text' => 'ঈদ সেল', 'e_text::html' => '<p onclick="x()">দারুণ <strong>ছাড়</strong><script>alert(1)</script></p>', 'e_btn::label' => 'কিনুন', 'e_html::html' => 'no',
        ]], JSON_UNESCAPED_UNICODE));
        $section = $this->postJson(self::WRITE, ['mode' => 'section', 'document_id' => $page, 'node_id' => 's_main', 'language' => 'bn'])->assertOk()->json('data');
        $this->assertSame(['translations.bn', []], [$section['target'], $section['texts']]);
        $this->assertSame(['e_title', 'e_text', 'e_btn'], array_keys($section['elements']));
        $this->assertSame('<p>দারুণ <strong>ছাড়</strong></p>', $section['elements']['e_text']['html']);
        $this->assertStringNotContainsString('e_html', $fake->requests[1]['conversation']->messages[0]->text());

        // Translate: the saved base texts go in; nothing to translate is skipped.
        $fake->answer(json_encode(['texts' => ['e_btn::label' => 'এখনই কিনুন']], JSON_UNESCAPED_UNICODE));
        $translated = $this->postJson(self::WRITE, ['mode' => 'translate', 'document_id' => $page, 'node_id' => 'e_btn', 'language' => 'bn'])->assertOk()->json('data');
        $this->assertSame(['label' => 'এখনই কিনুন'], $translated['texts']);
        $this->assertStringContainsString('"current":"Shop"', $fake->requests[2]['conversation']->messages[0]->text());

        // An element the editor has not saved yet: its type and texts come with the request.
        $fake->answer(json_encode(['texts' => ['e_new::title' => 'Why shop with us', 'e_new::text' => 'Fresh every day.']]));
        $new = $this->postJson(self::WRITE, ['mode' => 'element', 'document_id' => $page, 'node_id' => 'e_new', 'type' => 'icon_box', 'language' => 'en'])->assertOk()->json('data.texts');
        $this->assertSame(['title' => 'Why shop with us', 'text' => 'Fresh every day.'], $new);

        // Unknown nodes, nothing to write, unusable answers, refusals and failures.
        $this->postJson(self::WRITE, ['mode' => 'element', 'document_id' => $page, 'node_id' => 'e_nope', 'language' => 'en'])->assertStatus(422)->assertJsonPath('error.code', 'NODE_NOT_FOUND');
        $this->postJson(self::WRITE, ['mode' => 'section', 'document_id' => $page, 'node_id' => 'e_title', 'language' => 'en'])->assertStatus(422)->assertJsonPath('error.code', 'NODE_NOT_FOUND');
        $this->postJson(self::WRITE, ['mode' => 'element', 'document_id' => $page, 'node_id' => 'e_html', 'language' => 'en'])->assertStatus(422)->assertJsonPath('error.code', 'NO_TEXT_FIELDS');
        $fake->answer('Sorry, here you go: Eid!');
        $fake->refuse();
        $fake->fail();
        foreach (['failed', 'refused', 'failed'] as $reason) {
            $this->postJson(self::WRITE, $request)->assertStatus(422)->assertJsonPath('error.details.reason', $reason);
        }

        // The monthly budget is respected.
        $calls = $fake->callCount();
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => 100])->assertOk();
        $this->postJson(self::WRITE, $request)->assertStatus(422)->assertJsonPath('error.details.reason', 'budget_exceeded');
        $this->assertSame($calls, $fake->callCount());
    }

    public function test_ai_writer_limits_section_size(): void
    {
        $this->fakeAi();
        $page = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:big', 'title' => 'Big'])->json('data.id');
        $elements = [];
        for ($i = 0; $i < 21; $i++) {
            $elements[] = ['id' => "e_cta{$i}", 'type' => 'icon_box', 'props' => ['title' => 'Title', 'text' => 'Text']];
        }
        $this->save($page, ['sections' => [$this->section('s_big', $elements)]])->assertOk();
        $this->postJson(self::WRITE, ['mode' => 'section', 'document_id' => $page, 'node_id' => 's_big', 'language' => 'en'])
            ->assertStatus(422)->assertJsonPath('error.code', 'TOO_MANY_FIELDS')->assertJsonPath('error.details.limit', 40);
    }

    public function test_page_seo_is_in_the_render_payload_and_the_html_shell(): void
    {
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => true])->assertOk();
        $photo = $this->postJson('/api/v1/media', ['file' => UploadedFile::fake()->image('eid.jpg', 1200, 630)])->assertCreated()->json('data.id');
        $seo = [
            'title' => 'Eid sale — fresh picks', 'description' => 'Up to 30% off & free delivery.', 'image' => ['media_id' => $photo], 'noindex' => false,
            'translations' => ['bn' => ['title' => 'ঈদ সেল']],
        ];
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->json('data.id');
        $saved = $this->save($home, ['seo' => $seo, 'sections' => [$this->section('s_main', [$this->heading('e_main', 'Hi')])]])->assertOk()->json('data.content');
        $this->assertSame(['schema_version', 'seo', 'sections'], array_keys($saved));
        $this->assertSame(['title', 'description', 'image', 'noindex', 'translations'], array_keys($saved['seo']));

        // Not live before publishing.
        $this->assertStringContainsString('<title>Berry Kids</title>', $this->get('http://berry.test/')->getContent());
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $payload = $this->getJson(self::HOME)->assertOk()->json('data.document.seo');
        $this->assertSame(['Eid sale — fresh picks', 'Up to 30% off & free delivery.', false, $photo], [$payload['title'], $payload['description'], $payload['noindex'], $payload['image']['media_id']]);
        $this->assertStringContainsString('/storage/', $payload['image']['url']);
        $this->assertSame(['ঈদ সেল', 'Up to 30% off & free delivery.'], array_values(array_slice($this->getJson(self::HOME.'?lang=bn')->json('data.document.seo'), 0, 2)));

        $html = $this->get('http://berry.test/')->assertOk()->getContent();
        $this->assertStringContainsString('<title>Eid sale — fresh picks</title>', $html);
        $this->assertStringContainsString('<meta name="description" content="Up to 30% off &amp; free delivery.">', $html);
        $this->assertStringContainsString('<meta property="og:title" content="Eid sale — fresh picks">', $html);
        $this->assertMatchesRegularExpression('#<meta property="og:image" content="http://berry\.test/storage/[^"]+">#', $html);
        $this->assertStringContainsString('<meta name="twitter:card" content="summary_large_image">', $html);
        $this->assertStringNotContainsString('name="robots"', $html);
        $this->assertStringContainsString('<title>ঈদ সেল</title>', $this->get('http://berry.test/?lang=bn')->getContent());

        // noindex on a campaign page; seo is refused outside pages.
        $landing = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:quiet', 'title' => 'Quiet'])->json('data.id');
        $this->save($landing, ['seo' => ['noindex' => true], 'sections' => [$this->section('s_q', [$this->heading('e_q', 'Members only')])]])->assertOk();
        $this->postJson(self::DOCS."/{$landing}/publish")->assertOk();
        $quiet = $this->get('http://berry.test/p/quiet')->assertOk();
        $this->assertStringContainsString('<meta name="robots" content="noindex, follow">', $quiet->getContent());
        $this->assertStringContainsString('<title>Quiet | Berry Kids</title>', $quiet->getContent(), 'No title: the fallback stays.');
        $quiet->assertHeader('X-Robots-Tag', 'noindex');
        $header = $this->postJson(self::DOCS, ['kind' => 'header', 'key' => 'header', 'title' => 'Header'])->json('data.id');
        $this->save($header, ['seo' => ['title' => 'x'], 'sections' => []])->assertUnprocessable()->assertJsonPath('error.details.errors.0.path', 'seo');
        // Another organization's image is refused.
        $this->openStore('Tiny Shop', 'tiny.test');
        $theirs = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->json('data.id');
        $this->save($theirs, ['seo' => ['image' => ['media_id' => $photo]], 'sections' => []])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.code', 'MEDIA_NOT_FOUND')->assertJsonPath('error.details.errors.0.path', 'seo.image.media_id');
    }
}
