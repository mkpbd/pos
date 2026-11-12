<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use App\Modules\Storefront\Infrastructure\Notifications\FormSubmissionEmail;
use App\Modules\Storefront\Infrastructure\Notifications\FormSubmissionNotification;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B8b: visitors send builder forms (published, live forms only; answers checked against the
 * published fields; honeypot; size and rate limits), staff are notified (inbox + optional
 * e-mail), and staff read, filter, export, mark and delete submissions — per organization.
 */
class StoreBuilderFormsTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const STORE = 'http://berry.test/api/v1/store';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Date::setTestNow('2026-11-12T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        // Many submissions per test (the limit itself: test_answers_are_checked_…).
        config(['pos.form_rate_limit' => 1000]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function form(array $overrides = []): array
    {
        return ['id' => 'e_form', 'type' => 'form', 'props' => $overrides + [
            'title' => 'Book a fitting',
            'fields' => [
                ['id' => 'f_name', 'kind' => 'text', 'label' => 'Your name', 'required' => true],
                ['id' => 'f_email', 'kind' => 'email', 'label' => 'E-mail', 'required' => true, 'reply_to' => true],
                ['id' => 'f_size', 'kind' => 'radio', 'label' => 'Size', 'options' => [['id' => 'o_s', 'label' => 'Small'], ['id' => 'o_l', 'label' => 'Large']]],
                ['id' => 'f_message', 'kind' => 'textarea', 'label' => 'Message', 'max_length' => 200],
            ],
            'success_message' => 'Thanks, see you soon!',
            'notify_email' => 'owner@example.com',
        ], 'translations' => ['bn' => ['success_message' => 'ধন্যবাদ, শিগগিরই দেখা হবে!']]];
    }

    /**
     * A builder document with the elements: created, saved and (unless `$publish` is false) published.
     *
     * @param  list<array<string, mixed>>  $elements
     */
    private function document(array $elements, string $kind = 'page', string $key = 'home', bool $publish = true): string
    {
        $id = $this->postJson(self::DOCS, ['kind' => $kind, 'key' => $key, 'title' => 'Doc '.$key])->assertCreated()->json('data.id');
        $this->saveDraft($id, $elements)->assertOk();
        if ($publish) {
            $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        }

        return $id;
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     */
    private function saveDraft(string $id, array $elements, array $section = []): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [$section + [
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]]]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function submit(string $document, array $body, string $element = 'e_form', string $host = 'berry.test', string $query = ''): TestResponse
    {
        return $this->postJson("http://{$host}/api/v1/store/forms/{$document}/{$element}{$query}", $body, ['User-Agent' => 'Test browser']);
    }

    /**
     * @return array<string, mixed>
     */
    private static function answers(array $overrides = []): array
    {
        return ['values' => $overrides + ['f_name' => 'Rahima', 'f_email' => 'Rahima@Example.com', 'f_size' => 'o_l', 'f_message' => 'See you on Friday.'], 'page_path' => '/p/fittings'];
    }

    public function test_a_visitor_sends_a_form_and_staff_are_told(): void
    {
        Notification::fake();
        $home = $this->document([self::form()]);
        $manager = $this->createUserWithRole($this->t['organization'], SystemRole::OnlineStoreManager);
        $cashier = $this->createUserWithRole($this->t['organization'], SystemRole::Cashier);
        $this->app['auth']->forgetGuards();

        $this->assertSame(['message' => 'Thanks, see you soon!'], $this->submit($home, self::answers())->assertStatus(202)->json('data'));
        $this->submit($home, self::answers())->assertStatus(202);
        $this->submit($home, self::answers(), query: '?lang=bn')->assertStatus(202)->assertJsonPath('data.message', 'ধন্যবাদ, শিগগিরই দেখা হবে!');

        $submission = $this->inTenant($this->t['organization'], fn () => BuilderFormSubmission::query()->orderBy('created_at')->firstOrFail());
        $this->assertSame([
            'document_id' => $home, 'element_id' => 'e_form', 'form_title' => 'Book a fitting', 'reply_to' => 'rahima@example.com',
            'locale' => 'en', 'page_path' => '/p/fittings', 'user_agent' => 'Test browser', 'status' => 'new',
        ], array_intersect_key($submission->toArray(), array_flip(['document_id', 'element_id', 'form_title', 'reply_to', 'locale', 'page_path', 'user_agent', 'status'])));
        $this->assertEquals(['f_name' => 'Rahima', 'f_email' => 'rahima@example.com', 'f_size' => 'Large', 'f_message' => 'See you on Friday.'], $submission->values);
        $this->assertEquals([['id' => 'f_name', 'label' => 'Your name', 'kind' => 'text'], ['id' => 'f_email', 'label' => 'E-mail', 'kind' => 'email'], ['id' => 'f_size', 'label' => 'Size', 'kind' => 'radio'], ['id' => 'f_message', 'label' => 'Message', 'kind' => 'textarea']], $submission->fields);
        $this->assertSame(3, $this->inTenant($this->t['organization'], fn () => BuilderFormSubmission::query()->count()));

        // Inbox for everyone with forms.view (the admin and the online store manager, not the cashier).
        Notification::assertSentTo([$this->t['admin'], $manager], FormSubmissionNotification::class, function (FormSubmissionNotification $n, array $channels, object $notifiable) {
            $data = $n->toArray($notifiable);

            return $channels === ['database'] && $data['title'] === 'New form submission: Book a fitting'
                && $data['message'] === 'Your name: Rahima · E-mail: rahima@example.com'
                && str_starts_with($data['link'], '/content/forms/') && $n->databaseType($notifiable) === 'storefront.form_submitted';
        });
        Notification::assertNotSentTo($cashier, FormSubmissionNotification::class);
        // The form's extra recipient gets the answers; replies go to the visitor.
        Notification::assertSentTo(new AnonymousNotifiable, FormSubmissionEmail::class, function (FormSubmissionEmail $mail, array $channels, AnonymousNotifiable $notifiable) {
            $message = $mail->toMail($notifiable);

            return $notifiable->routes['mail'] === 'owner@example.com'
                && $message->replyTo === [['rahima@example.com', null]]
                && in_array('Size: Large', $message->introLines, true)
                && $message->subject === 'New form submission: Book a fitting';
        });

        // The published page never shows the address.
        $this->assertStringNotContainsString('owner@example.com', (string) $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->getContent());
    }

    public function test_answers_are_checked_and_bots_and_floods_are_turned_away(): void
    {
        $home = $this->document([self::form(['consent' => ['text' => 'I agree', 'link' => null]])]);
        $this->app['auth']->forgetGuards();

        $this->submit($home, ['values' => ['f_email' => 'nope', 'f_size' => 'o_xl', 'f_message' => str_repeat('a', 201), 'f_extra' => 'x']])
            ->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED')
            ->assertJsonValidationErrors(['values.f_name', 'values.f_email', 'values.f_size', 'values.f_message', 'values.f_extra', 'consent'], 'error.details');
        $this->submit($home, ['values' => ['a', 'b'], 'consent' => true])->assertUnprocessable()->assertJsonValidationErrors(['values'], 'error.details');
        $this->submit($home, [])->assertUnprocessable();
        $this->submit($home, self::answers() + ['consent' => true])->assertStatus(202);

        // The honeypot: accepted silently, nothing stored.
        $this->submit($home, self::answers() + ['consent' => true, 'website' => 'http://spam.example'])->assertStatus(202)->assertJsonPath('data.message', 'Thanks, see you soon!');
        $this->assertSame(1, $this->inTenant($this->t['organization'], fn () => BuilderFormSubmission::query()->count()));

        // At most 32 KB.
        $this->submit($home, self::answers(['f_message' => str_repeat('a', 33000)]) + ['consent' => true])->assertStatus(413)->assertJsonPath('error.code', 'PAYLOAD_TOO_LARGE');

        // The `forms` limit per visitor (POS_FORM_RATE_LIMIT).
        config(['pos.form_rate_limit' => 2]);
        $this->withServerVariables(['REMOTE_ADDR' => '10.0.0.9']);
        $this->submit($home, self::answers() + ['consent' => true])->assertStatus(202);
        $this->submit($home, self::answers() + ['consent' => true])->assertStatus(202);
        $this->submit($home, self::answers() + ['consent' => true])->assertStatus(429);
    }

    public function test_only_live_published_forms_take_answers(): void
    {
        // A form only in the draft: not live.
        $home = $this->document([self::form()]);
        $this->saveDraft($home, [self::form(), ['id' => 'e_new', 'type' => 'form', 'props' => []]])->assertOk();
        // A hidden form, and a form in a section that has not started yet.
        $landing = $this->document([array_merge(self::form(), ['hidden' => true])], key: 'landing:fittings');
        $later = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:later', 'title' => 'Later'])->json('data.id');
        $this->saveDraft($later, [self::form()], ['schedule' => ['starts_at' => '2026-11-20T00:00:00+06:00', 'ends_at' => null]])->assertOk();
        $this->postJson(self::DOCS."/{$later}/publish")->assertOk();
        $unpublished = $this->document([self::form()], key: 'landing:draft', publish: false);
        // A popup: only while it is switched on.
        $popup = $this->postJson(self::DOCS, ['kind' => 'popup', 'title' => 'Ask us'])->json('data.id');
        $revision = $this->getJson(self::DOCS."/{$popup}")->json('data.draft_revision');
        $this->putJson(self::DOCS."/{$popup}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_p', 'type' => 'section', 'columns' => [['id' => 'c_p', 'width' => ['base' => 100], 'elements' => [self::form()]]],
        ]]]])->assertOk();
        $this->postJson(self::DOCS."/{$popup}/publish")->assertOk();
        // A content page design: only while the page is published.
        $page = $this->postJson('/api/v1/cms/pages', ['slug' => 'fittings', 'title' => 'Fittings', 'status' => 'draft'])->assertCreated()->json('data.id');
        $cms = $this->document([self::form()], key: "cms:{$page}");
        $this->app['auth']->forgetGuards();

        $this->submit($home, self::answers(), 'e_new')->assertNotFound()->assertJsonPath('error.code', 'FORM_NOT_FOUND');
        $this->submit($home, self::answers(), 'e_nope')->assertNotFound();
        $this->submit($landing, self::answers())->assertNotFound();
        $this->submit($later, self::answers())->assertNotFound();
        $this->submit($unpublished, self::answers())->assertNotFound();
        $this->submit($popup, self::answers())->assertNotFound();
        $this->submit($cms, self::answers())->assertNotFound();
        $this->submit('0199a5c1-0000-7000-8000-00000000ff01', self::answers())->assertNotFound();
        $this->submit($home, self::answers())->assertStatus(202);

        $this->actingAsUser($this->t['admin']);
        $this->patchJson(self::DOCS."/{$popup}", ['active' => true])->assertOk();
        $this->patchJson("/api/v1/cms/pages/{$page}", ['status' => 'published'])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->submit($popup, self::answers())->assertStatus(202);
        $this->submit($cms, self::answers())->assertStatus(202);

        // The schedule of the section starts: the form is live.
        Date::setTestNow('2026-11-20T00:00:01+06:00');
        $this->submit($later, self::answers())->assertStatus(202);

        // Another store can't take answers for this store's forms.
        $other = $this->openStore('Tiny Shop', 'tiny.test');
        $this->app['auth']->forgetGuards();
        $this->submit($home, self::answers(), host: 'tiny.test')->assertNotFound();
        $this->assertSame(0, $this->inTenant($other['organization'], fn () => BuilderFormSubmission::query()->count()));
    }

    public function test_a_failing_mail_never_fails_the_submission(): void
    {
        config(['mail.default' => 'missing-mailer']);
        $home = $this->document([self::form()]);
        $this->app['auth']->forgetGuards();

        $this->submit($home, self::answers())->assertStatus(202);
        $this->assertSame(1, $this->inTenant($this->t['organization'], fn () => BuilderFormSubmission::query()->count()));
        $this->assertSame(1, $this->t['admin']->fresh()->notifications()->where('type', 'storefront.form_submitted')->count());
    }

    public function test_staff_read_filter_export_mark_and_delete_submissions(): void
    {
        $home = $this->document([self::form()]);
        $popup = $this->postJson(self::DOCS, ['kind' => 'popup', 'title' => 'Newsletter', 'template' => 'popup-contact-form'])->json('data.id');
        $this->postJson(self::DOCS."/{$popup}/publish")->assertOk();
        $this->patchJson(self::DOCS."/{$popup}", ['active' => true])->assertOk();
        $popupForm = $this->getJson(self::DOCS."/{$popup}")->json('data.content.sections.0.columns.0.elements.0.id');
        $this->app['auth']->forgetGuards();

        $this->submit($home, self::answers());
        Date::setTestNow('2026-11-13T10:00:00+06:00');
        $this->submit($home, self::answers(['f_name' => 'Karim', 'f_email' => 'karim@example.com', 'f_size' => 'o_s']));
        Date::setTestNow('2026-11-13T10:05:00+06:00');
        $this->submit($popup, ['values' => ['f_name' => 'Nadia', 'f_email' => 'nadia@example.com', 'f_message' => 'Do you ship to Sylhet?']], $popupForm)->assertStatus(202);

        $this->actingAsUser($this->t['admin']);
        $forms = $this->getJson('/api/v1/forms')->assertOk()->json('data');
        $this->assertSame([
            ['document_id' => $popup, 'element_id' => $popupForm, 'title' => 'Questions about a product?', 'document_title' => 'Newsletter', 'document_kind' => 'popup', 'total' => 1, 'new' => 1],
            ['document_id' => $home, 'element_id' => 'e_form', 'title' => 'Book a fitting', 'document_title' => 'Doc home', 'document_kind' => 'page', 'total' => 2, 'new' => 2],
        ], array_map(fn (array $f) => array_diff_key($f, ['last_submitted_at' => true]), $forms));

        $list = $this->getJson("/api/v1/forms/submissions?form={$home}:e_form")->assertOk();
        $this->assertSame(['Karim', 'Rahima'], array_column(array_column($list->json('data'), 'values'), 'f_name'));
        $this->assertSame(['new' => 2, 'read' => 0, 'archived' => 0], $list->json('meta.status_counts'));
        $this->assertSame('Doc home', $list->json('data.0.document_title'));
        $this->assertSame('Your name: Karim · E-mail: karim@example.com', $list->json('data.0.summary'));
        $this->assertArrayNotHasKey('ip', $list->json('data.0'));
        $this->assertSame(['Nadia'], array_column(array_column($this->getJson('/api/v1/forms/submissions?search=sylhet')->json('data'), 'values'), 'f_name'));
        $this->assertCount(2, $this->getJson('/api/v1/forms/submissions?from=2026-11-13&to=2026-11-13')->json('data'));
        $this->assertCount(1, $this->getJson('/api/v1/forms/submissions?to=2026-11-12')->json('data'));
        $this->getJson('/api/v1/forms/submissions?form=nope')->assertUnprocessable();
        $this->getJson('/api/v1/forms/submissions?status=spam')->assertUnprocessable();

        $id = $list->json('data.0.id');
        $detail = $this->getJson("/api/v1/forms/submissions/{$id}")->assertOk();
        $this->assertSame(['Test browser', 'new', null], [$detail->json('data.user_agent'), $detail->json('data.status'), $detail->json('data.read_by')]);
        $this->assertArrayHasKey('ip', $detail->json('data'));

        $read = $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'read'])->assertOk();
        $this->assertSame(['read', $this->t['admin']->id], [$read->json('data.status'), $read->json('data.read_by.id')]);
        $this->assertNotNull($read->json('data.read_at'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'form_submission.status_changed']);
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'archived'])->assertOk()->assertJsonPath('data.read_by.id', $this->t['admin']->id);
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'new'])->assertOk()->assertJsonPath('data.read_at', null);
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'spam'])->assertUnprocessable();
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'archived'])->assertOk();
        $this->assertSame(['new' => 1, 'read' => 0, 'archived' => 1], $this->getJson("/api/v1/forms/submissions?form={$home}:e_form&status=new")->json('meta.status_counts'));

        // Export: one column per field of the chosen form.
        $csv = $this->get("/api/v1/forms/submissions?form={$home}:e_form&export=csv")->assertOk();
        $content = $csv->streamedContent();
        $this->assertStringContainsString('Your name', $content);
        $this->assertStringContainsString('Size', $content);
        $this->assertStringContainsString('Large', $content);
        $this->assertStringContainsString('Karim', $content);
        $this->assertStringNotContainsString('Nadia', $content);
        $this->assertDatabaseHas('audit_logs', ['action' => 'export.created']);
        $this->assertStringContainsString('Answers', $this->get('/api/v1/forms/submissions?export=csv')->assertOk()->streamedContent());

        $this->deleteJson("/api/v1/forms/submissions/{$id}")->assertNoContent();
        $this->getJson("/api/v1/forms/submissions/{$id}")->assertNotFound();
        $this->assertDatabaseHas('audit_logs', ['action' => 'form_submission.deleted']);

        // Deleting the page keeps its messages.
        $this->deleteJson(self::DOCS."/{$popup}")->assertNoContent();
        $orphan = collect($this->getJson('/api/v1/forms')->json('data'))->firstWhere('document_id', $popup);
        $this->assertSame([null, null, 1, 'Questions about a product?'], [$orphan['document_title'], $orphan['document_kind'], $orphan['total'], $orphan['title']]);
    }

    public function test_permissions_and_isolation(): void
    {
        $home = $this->document([self::form()]);
        $this->app['auth']->forgetGuards();
        $this->submit($home, self::answers())->assertStatus(202);
        $id = $this->inTenant($this->t['organization'], fn () => BuilderFormSubmission::query()->value('id'));

        // A cashier has no access; an online store manager has both permissions.
        $this->actingAsUser($this->createUserWithRole($this->t['organization'], SystemRole::Cashier));
        $this->getJson('/api/v1/forms')->assertForbidden();
        $this->getJson('/api/v1/forms/submissions')->assertForbidden();
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'read'])->assertForbidden();
        $this->actingAsUser($this->createUserWithRole($this->t['organization'], SystemRole::OnlineStoreManager));
        $this->getJson("/api/v1/forms/submissions/{$id}")->assertOk();
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'read'])->assertOk();

        // Viewing only (forms.view): read and export, no changes.
        $this->actingAsUser($this->t['admin']);
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Form reader', 'permissions' => ['forms.view']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($this->t['organization'], $this->inTenant($this->t['organization'], fn () => Role::query()->findOrFail($roleId)));
        $this->actingAsUser($reader);
        $this->getJson('/api/v1/forms/submissions')->assertOk();
        $this->get('/api/v1/forms/submissions?export=xlsx')->assertOk();
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'archived'])->assertForbidden();
        $this->deleteJson("/api/v1/forms/submissions/{$id}")->assertForbidden();

        // Another organization sees none of it.
        $other = $this->openStore('Tiny Shop', 'tiny.test');
        $this->assertSame([], $this->getJson('/api/v1/forms')->assertOk()->json('data'));
        $this->assertSame([], $this->getJson('/api/v1/forms/submissions')->assertOk()->json('data'));
        $this->getJson("/api/v1/forms/submissions/{$id}")->assertNotFound();
        $this->patchJson("/api/v1/forms/submissions/{$id}", ['status' => 'archived'])->assertNotFound();
        $this->deleteJson("/api/v1/forms/submissions/{$id}")->assertNotFound();
        $this->assertSame(1, $this->inTenant($this->t['organization'], fn () => BuilderFormSubmission::query()->count()));
        $this->assertNotNull($other['admin']);
    }
}
