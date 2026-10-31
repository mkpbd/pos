<?php

namespace App\Modules\Cms\Tests\Feature;

use App\Modules\Cms\Infrastructure\Notifications\ConfirmNewsletterSubscription;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class ContactAndNewsletterTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    /**
     * @return array{organization: Organization, admin: User}
     */
    private function store(string $name, string $host): array
    {
        $tenant = $this->provisionTenant($name);
        $this->actingAsUser($tenant['admin']);
        $this->postJson('/api/v1/storefront/domains', ['host' => $host])->assertCreated();
        $this->patchJson('/api/v1/storefront/settings', ['site_name' => $name, 'is_enabled' => true])->assertOk();
        $this->app['auth']->forgetGuards();

        return $tenant;
    }

    /**
     * The token in the most recent confirmation (or unsubscribe) link sent to $email.
     */
    private function tokenFor(string $email, string $kind = 'confirm'): string
    {
        $token = null;
        Notification::assertSentTo(new AnonymousNotifiable, ConfirmNewsletterSubscription::class, function (ConfirmNewsletterSubscription $n, array $channels, AnonymousNotifiable $notifiable) use ($email, $kind, &$token) {
            if ($notifiable->routes['mail'] !== $email) {
                return false;
            }
            parse_str((string) parse_url($kind === 'confirm' ? $n->confirmUrl : $n->unsubscribeUrl, PHP_URL_QUERY), $query);
            $token = $query['token'];

            return true;
        });

        return (string) $token;
    }

    public function test_contact_messages_are_stored_bots_are_dropped_and_staff_mark_them_handled(): void
    {
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        $this->store('Tiny Toes', 'tiny.test');

        $this->postJson('http://berry.test/api/v1/store/contact', ['name' => 'Rina', 'email' => 'Rina@Example.com', 'subject' => 'Sizes', 'message' => 'Do you have size 2T in stock?'])
            ->assertStatus(202);
        $this->postJson('http://berry.test/api/v1/store/contact', ['name' => 'Bot', 'email' => 'bot@spam.test', 'message' => 'Buy cheap watches now', 'website' => 'http://spam.test'])
            ->assertStatus(202);
        $this->postJson('http://berry.test/api/v1/store/contact', ['name' => 'X', 'email' => 'not-an-email', 'message' => 'short'])
            ->assertUnprocessable()->assertJsonValidationErrors(['email', 'message'], 'error.details');
        $this->postJson('http://tiny.test/api/v1/store/contact', ['name' => 'Tom', 'email' => 'tom@example.com', 'message' => 'Message for Tiny Toes'])->assertStatus(202);

        $this->actingAsUser($admin);
        $list = $this->getJson('/api/v1/cms/contact-messages')->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('meta.open', 1)
            ->assertJsonPath('data.0.email', 'rina@example.com')
            ->assertJsonPath('data.0.is_handled', false);
        $id = $list->json('data.0.id');

        $this->patchJson("/api/v1/cms/contact-messages/{$id}", ['is_handled' => true])->assertOk()->assertJsonPath('data.is_handled', true);
        $this->getJson('/api/v1/cms/contact-messages?status=open')->assertJsonCount(0, 'data')->assertJsonPath('meta.open', 0);
        $this->getJson('/api/v1/cms/contact-messages?status=handled')->assertJsonCount(1, 'data');
    }

    public function test_public_forms_are_rate_limited_per_visitor(): void
    {
        $this->store('Berry Kids', 'berry.test');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('http://berry.test/api/v1/store/contact', ['name' => 'Rina', 'email' => 'rina@example.com', 'message' => "Message number {$i}"])->assertStatus(202);
        }
        $this->postJson('http://berry.test/api/v1/store/contact', ['name' => 'Rina', 'email' => 'rina@example.com', 'message' => 'One message too many'])->assertStatus(429);
    }

    public function test_newsletter_double_opt_in_without_revealing_existing_addresses(): void
    {
        Notification::fake();
        ['admin' => $admin] = $this->store('Berry Kids', 'berry.test');
        Date::setTestNow('2026-11-01T10:00:00+06:00');

        $first = $this->postJson('http://berry.test/api/v1/store/newsletter', ['email' => 'Mina@Example.com'])->assertStatus(202)->json('data');
        Notification::assertSentToTimes(new AnonymousNotifiable, ConfirmNewsletterSubscription::class, 1);
        $token = $this->tokenFor('mina@example.com');
        Notification::assertSentTo(new AnonymousNotifiable, ConfirmNewsletterSubscription::class,
            fn (ConfirmNewsletterSubscription $n) => str_starts_with($n->confirmUrl, 'http://berry.test/newsletter/confirm?token=') && $n->storeName === 'Berry Kids');

        // Signing up again right away sends nothing new and answers the same.
        $this->postJson('http://berry.test/api/v1/store/newsletter', ['email' => 'mina@example.com'])->assertStatus(202)->assertJsonPath('data', $first);
        Notification::assertSentToTimes(new AnonymousNotifiable, ConfirmNewsletterSubscription::class, 1);

        $this->postJson('http://berry.test/api/v1/store/newsletter/confirm', ['token' => 'wrong'])->assertUnprocessable()->assertJsonPath('error.code', 'TOKEN_INVALID');
        $this->postJson('http://berry.test/api/v1/store/newsletter/confirm', ['token' => $token])->assertOk();
        $this->postJson('http://berry.test/api/v1/store/newsletter/confirm', ['token' => $token])->assertUnprocessable();

        // Already subscribed: same answer, no e-mail.
        Date::setTestNow('2026-11-02T10:00:00+06:00');
        $this->postJson('http://berry.test/api/v1/store/newsletter', ['email' => 'mina@example.com'])->assertStatus(202)->assertJsonPath('data', $first);
        Notification::assertSentToTimes(new AnonymousNotifiable, ConfirmNewsletterSubscription::class, 1);

        $this->postJson('http://berry.test/api/v1/store/newsletter', ['email' => 'pending@example.com'])->assertStatus(202);

        $this->actingAsUser($admin);
        $this->getJson('/api/v1/cms/newsletter-subscribers')->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.counts', ['pending' => 1, 'subscribed' => 1, 'unsubscribed' => 0]);
        $csv = $this->get('/api/v1/cms/newsletter-subscribers/export')->assertOk()->assertHeader('Content-Type', 'text/csv; charset=UTF-8')->streamedContent();
        $this->assertStringContainsString('mina@example.com', $csv);
        $this->assertStringNotContainsString('pending@example.com', $csv);

        $this->app['auth']->forgetGuards();
        $unsubscribe = $this->tokenFor('mina@example.com', 'unsubscribe');
        $this->postJson('http://berry.test/api/v1/store/newsletter/unsubscribe', ['token' => $unsubscribe])->assertOk();
        $this->postJson('http://berry.test/api/v1/store/newsletter/unsubscribe', ['token' => $unsubscribe])->assertOk();
        $this->postJson('http://berry.test/api/v1/store/newsletter/unsubscribe', ['token' => 'nope'])->assertUnprocessable();

        // Coming back after unsubscribing starts a new double opt-in.
        $this->postJson('http://berry.test/api/v1/store/newsletter', ['email' => 'mina@example.com'])->assertStatus(202);
        Notification::assertSentToTimes(new AnonymousNotifiable, ConfirmNewsletterSubscription::class, 3);
    }

    public function test_confirmation_links_expire_and_tokens_never_cross_stores(): void
    {
        Notification::fake();
        $this->store('Berry Kids', 'berry.test');
        $this->store('Tiny Toes', 'tiny.test');
        Date::setTestNow('2026-11-01T10:00:00+06:00');

        $this->postJson('http://berry.test/api/v1/store/newsletter', ['email' => 'mina@example.com'])->assertStatus(202);
        $token = $this->tokenFor('mina@example.com');

        $this->postJson('http://tiny.test/api/v1/store/newsletter/confirm', ['token' => $token])->assertUnprocessable();

        Date::setTestNow('2026-11-08T10:00:01+06:00');
        $this->postJson('http://berry.test/api/v1/store/newsletter/confirm', ['token' => $token])->assertUnprocessable()->assertJsonPath('error.code', 'TOKEN_INVALID');
    }
}
