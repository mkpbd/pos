<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Domain\Builder\PopupSettings;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B8b: popups and bars — created blank or from a template, edited and published like pages,
 * switched on and off (storefront.publish), scheduled, served to visitors in priority order
 * (never on checkout / cart / account / order pages), previewed by staff, and isolated per
 * organization.
 */
class StoreBuilderPopupsTest extends TestCase
{
    use BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const POPUPS = 'http://berry.test/api/v1/store/builder/popups';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Queue::fake();
        Date::setTestNow('2026-11-12T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function popup(string $title = 'Weekend offer', ?string $template = null): TestResponse
    {
        return $this->postJson(self::DOCS, ['kind' => 'popup', 'title' => $title] + ($template === null ? [] : ['template' => $template]));
    }

    /**
     * @param  array<string, mixed>  $settings
     * @param  list<array<string, mixed>>|null  $elements
     */
    private function save(string $id, array $settings, ?array $elements = null): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');
        $elements ??= [
            ['id' => 'e_heading', 'type' => 'heading', 'props' => ['text' => 'Hello', 'level' => 2], 'translations' => ['bn' => ['text' => 'হ্যালো']]],
            ['id' => 'e_ok', 'type' => 'button', 'props' => ['label' => 'OK', 'link' => ['url' => '/'], 'action' => 'dismiss']],
        ];

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'popup' => $settings, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]]]);
    }

    private function live(string $id, array $settings = []): void
    {
        $this->save($id, $settings)->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        $this->patchJson(self::DOCS."/{$id}", ['active' => true])->assertOk();
    }

    /**
     * @return list<string>
     */
    private function served(string $query = ''): array
    {
        return array_column($this->getJson(self::POPUPS.$query)->assertOk()->json('data.popups'), 'id');
    }

    private function role(Organization $organization, string $name, array $permissions): User
    {
        $roleId = $this->postJson('/api/v1/roles', ['name' => $name, 'permissions' => $permissions])->assertCreated()->json('data.id');

        return $this->createUserWithRole($organization, $this->inTenant($organization, fn () => Role::query()->findOrFail($roleId)));
    }

    public function test_a_popup_is_created_published_switched_on_and_served(): void
    {
        $created = $this->popup()->assertCreated()->json('data');
        $id = $created['id'];
        $this->assertMatchesRegularExpression('/^popup:[0-9a-f-]{36}$/', $created['key']);
        $this->assertSame(['popup', 'Weekend offer', false, 'draft', null], [$created['kind'], $created['title'], $created['active'], $created['status'], $created['path']]);
        $this->assertSame(['layout' => 'modal', 'trigger' => 'on_load', 'starts_at' => null, 'ends_at' => null], $created['popup']);
        $this->assertStringEndsWith("://berry.test/?preview=draft&popup={$id}", $created['preview_url']);
        $this->assertSame(['schema_version' => 1, 'popup' => array_merge(PopupSettings::defaults(), ['translations' => []]), 'sections' => []], $created['content']);
        $this->assertStringContainsString('"translations":{}', (string) $this->getJson(self::DOCS."/{$id}")->getContent());
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_created']);

        // An empty popup can't be published; a never-published one can't be switched on.
        $this->postJson(self::DOCS."/{$id}/publish")->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_EMPTY');
        $this->patchJson(self::DOCS."/{$id}", ['active' => true])->assertUnprocessable()->assertJsonPath('error.code', 'POPUP_NOT_PUBLISHED');

        // Popups take their own element set and settings.
        $this->save($id, [], [['id' => 'e_grid', 'type' => 'product_grid', 'props' => []]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.code', 'ELEMENT_NOT_ALLOWED');
        $this->save($id, ['pages' => ['kind' => 'paths', 'paths' => ['/checkout']]])->assertUnprocessable()
            ->assertJsonPath('error.details.errors.0.path', 'popup.pages.paths.0')
            ->assertJsonPath('error.details.errors.0.code', 'POPUP_PAGE_FORBIDDEN');

        $settings = ['layout' => 'slide_in', 'label' => 'Weekend', 'priority' => 20, 'translations' => ['bn' => ['label' => 'সপ্তাহান্ত']], 'trigger' => ['kind' => 'on_scroll', 'scroll_percent' => 40]];
        $this->save($id, $settings)->assertOk()->assertJsonPath('data.popup.layout', 'slide_in')->assertJsonPath('data.status', 'draft');
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk()->assertJsonPath('data.status', 'off')->assertJsonPath('data.active', false);

        // Published but off: nothing for visitors.
        $this->app['auth']->forgetGuards();
        $this->getJson(self::POPUPS)->assertOk()->assertJsonPath('data.popups', [])->assertJsonPath('data.never_on', PopupSettings::NEVER_ON);

        $this->actingAsUser($this->t['admin']);
        $this->patchJson(self::DOCS."/{$id}", ['active' => true])->assertOk()->assertJsonPath('data.active', true)->assertJsonPath('data.status', 'live');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_popup_activated']);

        $this->app['auth']->forgetGuards();
        $response = $this->getJson(self::POPUPS)->assertOk()->assertHeader('ETag');
        $popup = $response->json('data.popups.0');
        $this->assertSame($id, $popup['id']);
        $this->assertSame(1, $popup['version']);
        $this->assertSame(['layout', 'position', 'width', 'overlay', 'close_on_overlay', 'label', 'trigger', 'frequency', 'stop_after_action', 'pages', 'devices', 'audience', 'priority'], array_keys($popup['settings']));
        $this->assertSame(['slide_in', 'Weekend', ['kind' => 'on_scroll', 'delay_seconds' => 5, 'scroll_percent' => 40]], [$popup['settings']['layout'], $popup['settings']['label'], $popup['settings']['trigger']]);
        $this->assertSame(['sections', 'media', 'data'], array_keys($popup['payload']));
        $this->assertSame('Hello', $popup['payload']['sections'][0]['columns'][0]['elements'][0]['props']['text']);
        $this->assertSame('dismiss', $popup['payload']['sections'][0]['columns'][0]['elements'][1]['props']['action']);
        $this->assertStringNotContainsString('"translations"', (string) $response->getContent());
        $this->assertSame(['/checkout', '/cart', '/account', '/order'], $response->json('data.never_on'));

        $bn = $this->getJson(self::POPUPS.'?lang=bn')->assertOk()->json('data.popups.0');
        $this->assertSame(['সপ্তাহান্ত', 'হ্যালো'], [$bn['settings']['label'], $bn['payload']['sections'][0]['columns'][0]['elements'][0]['props']['text']]);

        // Switching off removes it at once (the storefront cache is refreshed).
        $this->actingAsUser($this->t['admin']);
        $this->patchJson(self::DOCS."/{$id}", ['active' => false])->assertOk()->assertJsonPath('data.status', 'off');
        $this->app['auth']->forgetGuards();
        $this->assertSame([], $this->served());
    }

    public function test_priority_schedule_and_the_staff_draft_preview(): void
    {
        $low = $this->popup('Low')->json('data.id');
        $high = $this->popup('High')->json('data.id');
        $bar = $this->popup('Bar')->json('data.id');
        $later = $this->popup('Later')->json('data.id');
        $ended = $this->popup('Ended')->json('data.id');
        $draftOnly = $this->popup('Draft only')->json('data.id');
        $this->live($low, ['priority' => 10]);
        $this->live($high, ['priority' => 90]);
        $this->live($bar, ['layout' => 'bar_top', 'priority' => 10]);
        $this->live($later, ['starts_at' => '2026-11-13T00:00:00+06:00', 'priority' => 10]);
        $this->live($ended, ['ends_at' => '2026-11-12T09:00:00+06:00']);
        $this->save($draftOnly, ['label' => 'Draft'])->assertOk();

        $statuses = array_column($this->getJson(self::DOCS)->assertOk()->json('data'), 'status', 'title');
        $this->assertSame(['live', 'live', 'live', 'scheduled', 'expired', 'draft'], [$statuses['Low'], $statuses['High'], $statuses['Bar'], $statuses['Later'], $statuses['Ended'], $statuses['Draft only']]);
        // Non-popups carry no popup keys.
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data');
        $this->assertSame([null, null, null], [$home['active'], $home['status'], $home['popup']]);
        $this->patchJson(self::DOCS."/{$home['id']}", ['active' => true])->assertUnprocessable()->assertJsonPath('error.code', 'NOT_A_POPUP');

        // Staff preview of one draft, whatever its state.
        $preview = $this->getJson(self::POPUPS."?preview=draft&popup={$draftOnly}")->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $this->assertSame([$draftOnly], array_column($preview->json('data.popups'), 'id'));
        $this->assertNull($preview->json('data.popups.0.version'));
        $this->assertSame([], $this->getJson(self::POPUPS.'?preview=draft&popup=nope')->assertOk()->json('data.popups'));

        $this->app['auth']->forgetGuards();
        // Highest priority first, then the oldest; scheduled, ended and unpublished ones are not served.
        $this->assertSame([$high, $low, $bar], $this->served());
        // Visitors can't preview drafts.
        $this->assertSame([$high, $low, $bar], $this->served("?preview=draft&popup={$draftOnly}"));

        // The cached list expires when a scheduled popup starts.
        Date::setTestNow('2026-11-13T00:00:01+06:00');
        $this->assertSame([$high, $low, $bar, $later], $this->served());
    }

    public function test_switching_needs_publish_permission_and_popups_are_isolated(): void
    {
        $id = $this->popup()->json('data.id');
        $this->save($id, [])->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();

        $editor = $this->role($this->t['organization'], 'Editor', ['storefront.view', 'storefront.manage']);
        $this->actingAsUser($editor);
        $this->patchJson(self::DOCS."/{$id}", ['active' => true])->assertForbidden();
        $this->patchJson(self::DOCS."/{$id}", ['title' => 'Renamed'])->assertOk()->assertJsonPath('data.active', false);
        $this->patchJson(self::DOCS."/{$id}", [])->assertUnprocessable();

        // Another organization neither sees nor switches it, and its own popups stay on its store.
        $other = $this->openStore('Tiny Shop', 'tiny.test');
        $this->getJson(self::DOCS."/{$id}")->assertNotFound();
        $this->patchJson(self::DOCS."/{$id}", ['active' => true])->assertNotFound();
        $theirs = $this->popup('Theirs')->json('data.id');
        $this->live($theirs);
        $this->assertNotContains($id, array_column($this->getJson(self::DOCS)->json('data'), 'id'));

        $this->app['auth']->forgetGuards();
        $this->assertSame([], $this->served());
        $this->assertSame([$theirs], array_column($this->getJson('http://tiny.test/api/v1/store/builder/popups')->assertOk()->json('data.popups'), 'id'));
        // Staff of another store can't preview this store's popups.
        $this->actingAsUser($other['admin']);
        $this->assertSame([], $this->served("?preview=draft&popup={$id}"));
    }

    public function test_popups_start_from_templates(): void
    {
        $templates = $this->getJson('/api/v1/storefront/builder/templates?scope=popup')->assertOk()->json('data');
        $this->assertSame(['popup-newsletter', 'popup-exit-offer', 'popup-free-delivery-bar', 'popup-eid-sale', 'popup-cookie-notice', 'popup-contact-form'], array_column($templates, 'id'));
        foreach ($templates as $template) {
            $this->assertSame([['popup'], null, 'popup'], [$template['allowed_in'], $template['thumbnail_url'], $template['scope']]);
        }
        $this->assertSame(array_column($templates, 'id'), array_column($this->getJson('/api/v1/storefront/builder/templates?context=popup&source=builtin')->json('data'), 'id'));

        $cookie = $this->popup('Cookies', 'popup-cookie-notice')->assertCreated()->json('data');
        $this->assertSame(['bar_bottom', 'once_forever', true], [$cookie['content']['popup']['layout'], $cookie['content']['popup']['frequency']['kind'], $cookie['content']['popup']['stop_after_action']]);
        $this->assertStringContainsString('"action":"dismiss"', (string) json_encode($cookie['content']));
        $this->assertStringContainsString('/pages/privacy-policy', (string) json_encode($cookie['content'], JSON_UNESCAPED_SLASHES));
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_created']);

        // The exit offer shows the running coupon promotion — or goes without the discount.
        $without = $this->popup('Exit', 'popup-exit-offer')->assertCreated()->json('data.content');
        $this->assertStringNotContainsString('"type":"discount"', (string) json_encode($without));
        $promotion = $this->makePromotion($this->t['organization'], ['name' => 'Welcome', 'type' => 'percent', 'value' => '10', 'trigger' => 'coupon']);
        $this->makeCoupon($this->t['organization'], $promotion, 'WELCOME10');
        $with = $this->popup('Exit 2', 'popup-exit-offer')->assertCreated()->json('data.content');
        $this->assertStringContainsString('"promotion_id":"'.$promotion->id.'"', (string) json_encode($with));
        $this->assertSame('on_exit', $with['popup']['trigger']['kind']);

        // Every popup template applies and publishes.
        foreach (array_column($templates, 'id') as $template) {
            $id = $this->popup("From {$template}", $template)->assertCreated()->json('data.id');
            $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        }
        $applied = $this->postJson('/api/v1/storefront/builder/templates/popup-newsletter/instantiate', ['context' => 'popup'])->assertOk()->json('data');
        $this->assertSame('modal', $applied['popup']['layout']);
        $this->assertNull($this->postJson('/api/v1/storefront/builder/templates/neutral-contact-form/instantiate', ['context' => 'page'])->assertOk()->json('data.popup'));

        $this->popup('Bad', 'neutral-team')->assertUnprocessable()->assertJsonValidationErrors('template', 'error.details');
        $this->popup('Bad', 'nope')->assertUnprocessable();
        $this->postJson('/api/v1/storefront/builder/templates/popup-newsletter/instantiate', ['context' => 'page'])->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_NOT_ALLOWED');
    }

    public function test_published_forms_hide_the_notification_address(): void
    {
        $id = $this->popup()->json('data.id');
        $this->save($id, [], [[
            'id' => 'e_form', 'type' => 'form', 'props' => ['notify_email' => 'owner@example.com'],
        ]])->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        $this->patchJson(self::DOCS."/{$id}", ['active' => true])->assertOk();

        $this->assertSame('owner@example.com', $this->getJson(self::POPUPS."?preview=draft&popup={$id}")->json('data.popups.0.payload.sections.0.columns.0.elements.0.props.notify_email'));
        $this->app['auth']->forgetGuards();
        $public = $this->getJson(self::POPUPS)->assertOk();
        $this->assertNull($public->json('data.popups.0.payload.sections.0.columns.0.elements.0.props.notify_email'));
        $this->assertStringNotContainsString('owner@example.com', (string) $public->getContent());
    }
}
