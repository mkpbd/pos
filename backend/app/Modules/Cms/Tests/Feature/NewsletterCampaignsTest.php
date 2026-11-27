<?php

namespace App\Modules\Cms\Tests\Feature;

use App\Modules\Cms\Application\Actions\NewsletterCampaigns;
use App\Modules\Cms\Domain\SubscriberStatus;
use App\Modules\Cms\Infrastructure\Jobs\SendNewsletterCampaignJob;
use App\Modules\Cms\Infrastructure\Models\NewsletterSubscriber;
use App\Modules\Cms\Infrastructure\Notifications\NewsletterCampaignMail;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Symfony\Component\Mime\Email;
use Tests\TestCase;

class NewsletterCampaignsTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    protected function tearDown(): void
    {
        NewsletterCampaigns::$chunkSize = 200;
        parent::tearDown();
    }

    /**
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

    private function subscriber(Organization $organization, string $email, SubscriberStatus $status = SubscriberStatus::Subscribed): NewsletterSubscriber
    {
        return $this->inTenant($organization, fn () => NewsletterSubscriber::query()->create(['email' => $email, 'status' => $status]));
    }

    private function draft(string $subject = 'Eid sale', string $body = 'Up to **30%** off.'): string
    {
        return $this->postJson('/api/v1/newsletter/campaigns', ['subject' => $subject, 'body' => $body])->assertCreated()->json('data.id');
    }

    /**
     * @return list<string> addresses that got a (non-test) copy, in send order
     */
    private function recipients(): array
    {
        $to = [];
        Notification::sent(new AnonymousNotifiable, NewsletterCampaignMail::class, function (NewsletterCampaignMail $n, array $channels, AnonymousNotifiable $notifiable) use (&$to) {
            if (! $n->test) {
                $to[] = $notifiable->routes['mail'];
            }

            return true;
        });

        return $to;
    }

    public function test_drafts_are_created_listed_edited_and_deleted_with_audit_and_permission(): void
    {
        ['organization' => $org, 'admin' => $admin] = $this->store('Berry Kids', 'berry.test');

        $this->postJson('/api/v1/newsletter/campaigns', ['subject' => str_repeat('x', 151)])
            ->assertUnprocessable()->assertJsonValidationErrors(['subject', 'body'], 'error.details');

        $id = $this->draft();
        $this->getJson('/api/v1/newsletter/campaigns')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.subject', 'Eid sale')
            ->assertJsonPath('data.0.status', 'draft')
            ->assertJsonPath('data.0.sent_count', 0)
            ->assertJsonMissingPath('data.0.body');
        $this->getJson("/api/v1/newsletter/campaigns/{$id}")->assertOk()
            ->assertJsonPath('data.body', 'Up to **30%** off.')
            ->assertJsonPath('data.created_by', $admin->id);

        $this->patchJson("/api/v1/newsletter/campaigns/{$id}", ['subject' => 'Eid sale ends Friday'])->assertOk()
            ->assertJsonPath('data.subject', 'Eid sale ends Friday')
            ->assertJsonPath('data.body', 'Up to **30%** off.');
        $this->assertDatabaseHas('audit_logs', ['action' => 'newsletter_campaign.created', 'subject_id' => $id, 'organization_id' => $org->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'newsletter_campaign.updated', 'subject_id' => $id]);

        $this->deleteJson("/api/v1/newsletter/campaigns/{$id}")->assertNoContent();
        $this->getJson("/api/v1/newsletter/campaigns/{$id}")->assertNotFound();
        $this->assertDatabaseHas('audit_logs', ['action' => 'newsletter_campaign.deleted', 'subject_id' => $id]);

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier));
        $this->getJson('/api/v1/newsletter/campaigns')->assertForbidden();
        $this->getJson('/api/v1/newsletter/subscribers/summary')->assertForbidden();
    }

    public function test_a_test_copy_goes_only_to_the_given_address_and_the_audit_masks_it(): void
    {
        Notification::fake();
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->subscriber($org, 'mina@example.com');
        $id = $this->draft();

        $this->postJson("/api/v1/newsletter/campaigns/{$id}/test", ['email' => 'nope'])->assertUnprocessable();
        $this->postJson("/api/v1/newsletter/campaigns/{$id}/test", ['email' => 'owner@berry.test'])->assertStatus(202);

        Notification::assertSentToTimes(new AnonymousNotifiable, NewsletterCampaignMail::class, 1);
        Notification::assertSentTo(new AnonymousNotifiable, NewsletterCampaignMail::class, function (NewsletterCampaignMail $n, array $channels, AnonymousNotifiable $to) {
            $mail = $n->toMail($to);

            return $to->routes['mail'] === 'owner@berry.test' && $n->test && $n->unsubscribeUrl === null
                && $mail->subject === '[Test] Eid sale' && $n->storeName === 'Berry Kids';
        });
        $this->getJson("/api/v1/newsletter/campaigns/{$id}")->assertJsonPath('data.status', 'draft');
        $audit = DB::table('audit_logs')->where('action', 'newsletter_campaign.test_sent')->where('subject_id', $id)->value('new_values');
        $this->assertSame(['to' => 'o****@berry.test'], json_decode((string) $audit, true));
    }

    public function test_sending_reaches_confirmed_subscribers_only_in_chunks_and_only_once(): void
    {
        Notification::fake();
        NewsletterCampaigns::$chunkSize = 2;
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        foreach (['a', 'b', 'c', 'd', 'e'] as $name) {
            $this->subscriber($org, "{$name}@example.com");
        }
        $this->subscriber($org, 'pending@example.com', SubscriberStatus::Pending);
        $this->subscriber($org, 'gone@example.com', SubscriberStatus::Unsubscribed);
        $other = $this->provisionTenant('Tiny Toes');
        $this->subscriber($other['organization'], 'tiny@example.com');

        $this->getJson('/api/v1/newsletter/subscribers/summary')->assertOk()
            ->assertJsonPath('data', ['confirmed' => 5, 'pending' => 1, 'unsubscribed' => 1]);

        $id = $this->draft();
        // The queue runs synchronously in tests: the job has finished when the response comes.
        $this->postJson("/api/v1/newsletter/campaigns/{$id}/send")->assertStatus(202)
            ->assertJsonPath('data.status', 'sent')
            ->assertJsonPath('data.recipients_count', 5)
            ->assertJsonPath('data.sent_count', 5);

        $recipients = $this->recipients();
        sort($recipients);
        $this->assertSame(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com'], $recipients);
        $this->assertDatabaseHas('audit_logs', ['action' => 'newsletter_campaign.sent', 'subject_id' => $id, 'organization_id' => $org->id]);
        $this->getJson("/api/v1/newsletter/campaigns/{$id}")->assertJsonPath('data.status', 'sent')->assertJsonPath('data.sent_at', fn ($at) => $at !== null);

        // Not twice; a sent campaign can no longer be changed or deleted.
        $this->postJson("/api/v1/newsletter/campaigns/{$id}/send")->assertUnprocessable()->assertJsonPath('error.code', 'CAMPAIGN_NOT_DRAFT');
        $this->patchJson("/api/v1/newsletter/campaigns/{$id}", ['subject' => 'Again'])->assertUnprocessable()->assertJsonPath('error.code', 'CAMPAIGN_NOT_DRAFT');
        $this->deleteJson("/api/v1/newsletter/campaigns/{$id}")->assertUnprocessable()->assertJsonPath('error.code', 'CAMPAIGN_NOT_DRAFT');
        $this->assertCount(5, $this->recipients());
    }

    public function test_send_marks_the_campaign_sending_and_queues_one_job(): void
    {
        Queue::fake();
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->subscriber($org, 'mina@example.com');
        $id = $this->draft();

        $this->postJson("/api/v1/newsletter/campaigns/{$id}/send")->assertStatus(202)
            ->assertJsonPath('data.status', 'sending')
            ->assertJsonPath('data.recipients_count', 1)
            ->assertJsonPath('data.sent_count', 0);
        $this->postJson("/api/v1/newsletter/campaigns/{$id}/send")->assertJsonPath('error.code', 'CAMPAIGN_NOT_DRAFT');
        Queue::assertPushed(SendNewsletterCampaignJob::class, 1);
        Queue::assertPushed(SendNewsletterCampaignJob::class, fn (SendNewsletterCampaignJob $job) => $job->campaignId === $id && $job->organizationId === $org->id);
    }

    public function test_no_confirmed_subscribers_cannot_be_sent(): void
    {
        Notification::fake();
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $this->subscriber($org, 'pending@example.com', SubscriberStatus::Pending);
        $id = $this->draft();

        $this->postJson("/api/v1/newsletter/campaigns/{$id}/send")->assertUnprocessable()->assertJsonPath('error.code', 'NO_SUBSCRIBERS');
        $this->getJson("/api/v1/newsletter/campaigns/{$id}")->assertJsonPath('data.status', 'draft');
        Notification::assertNothingSent();
    }

    public function test_the_signed_unsubscribe_link_works_once_idempotently_and_rejects_tampering(): void
    {
        Notification::fake();
        $this->store('Tiny Toes', 'tiny.test');
        ['organization' => $org] = $this->store('Berry Kids', 'berry.test');
        $mina = $this->subscriber($org, 'mina@example.com');
        $other = $this->subscriber($org, 'rina@example.com');
        $this->postJson('/api/v1/newsletter/campaigns/'.$this->draft().'/send')->assertStatus(202);

        $url = null;
        $mail = null;
        Notification::assertSentTo(new AnonymousNotifiable, NewsletterCampaignMail::class, function (NewsletterCampaignMail $n, array $channels, AnonymousNotifiable $to) use (&$url, &$mail) {
            if ($to->routes['mail'] !== 'mina@example.com') {
                return false;
            }
            $url = $n->unsubscribeUrl;
            $mail = $n->toMail($to);

            return true;
        });
        $this->assertStringStartsWith('http://berry.test/newsletter/unsubscribe?subscriber='.$mina->id.'&signature=', $url);

        // List-Unsubscribe header (URL form) and the link in the body.
        $email = new Email;
        foreach ($mail->callbacks as $callback) {
            $callback($email);
        }
        $this->assertSame("<{$url}>", $email->getHeaders()->get('List-Unsubscribe')?->getBodyAsString());
        $this->assertStringContainsString('href="'.e($url).'"', (string) $mail->render());

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->app['auth']->forgetGuards();
        $api = fn (string $host, string $id, string $signature) => $this->postJson("http://{$host}/api/v1/store/newsletter/unsubscribe/{$id}?signature={$signature}");

        $api('berry.test', $mina->id, $query['signature'].'0')->assertUnprocessable()->assertJsonPath('error.code', 'TOKEN_INVALID');
        $api('berry.test', $other->id, $query['signature'])->assertUnprocessable()->assertJsonPath('error.code', 'TOKEN_INVALID');
        // Another store's host does not find the subscriber.
        $api('tiny.test', $mina->id, $query['signature'])->assertUnprocessable()->assertJsonPath('error.code', 'TOKEN_INVALID');
        $this->assertSame(SubscriberStatus::Subscribed, $mina->fresh()->status);

        // The storefront client's `lang` parameter does not break the signature; tampering still fails.
        $api('berry.test', $mina->id, $query['signature'].'0&lang=bn')->assertUnprocessable()->assertJsonPath('error.code', 'TOKEN_INVALID');
        $api('berry.test', $mina->id, $query['signature'].'&lang=bn')->assertOk()->assertJsonPath('data.already_unsubscribed', false);
        $api('berry.test', $mina->id, $query['signature'])->assertOk()->assertJsonPath('data.already_unsubscribed', true);
        $this->assertSame(SubscriberStatus::Unsubscribed, $mina->fresh()->status);
        $this->assertSame(SubscriberStatus::Subscribed, $other->fresh()->status);
    }

    public function test_markdown_is_rendered_without_raw_html_or_unsafe_links(): void
    {
        $mail = (new NewsletterCampaignMail('Berry Kids', 'News', "Hello **friends**\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1)) and [shop](https://berry.test/sale)", 'https://berry.test/newsletter/unsubscribe?subscriber=x&signature=y'))
            ->toMail(new AnonymousNotifiable);
        $html = (string) $mail->render();

        $this->assertMatchesRegularExpression('#<strong[^>]*>friends</strong>#', $html);
        $this->assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $html);
        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringNotContainsString('<img', $html);
        $this->assertStringNotContainsString('javascript:', $html);
        $this->assertStringContainsString('href="https://berry.test/sale"', $html);
        $this->assertMatchesRegularExpression('#<a [^>]*>click</a>#', $html);
    }

    public function test_campaigns_and_subscriber_counts_are_isolated_per_organization(): void
    {
        ['organization' => $berry] = $this->store('Berry Kids', 'berry.test');
        $this->subscriber($berry, 'mina@example.com');
        $id = $this->draft();

        $this->store('Tiny Toes', 'tiny.test');
        $this->getJson('/api/v1/newsletter/campaigns')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/newsletter/campaigns/{$id}")->assertNotFound();
        $this->patchJson("/api/v1/newsletter/campaigns/{$id}", ['subject' => 'Mine'])->assertNotFound();
        $this->postJson("/api/v1/newsletter/campaigns/{$id}/send")->assertNotFound();
        $this->postJson("/api/v1/newsletter/campaigns/{$id}/test", ['email' => 'x@tiny.test'])->assertNotFound();
        $this->deleteJson("/api/v1/newsletter/campaigns/{$id}")->assertNotFound();
        $this->getJson('/api/v1/newsletter/subscribers/summary')->assertJsonPath('data', ['confirmed' => 0, 'pending' => 0, 'unsubscribed' => 0]);
    }
}
