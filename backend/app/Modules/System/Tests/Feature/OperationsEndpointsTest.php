<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\System\Infrastructure\Jobs\QueueHeartbeat;
use App\Modules\System\Infrastructure\Mail\SystemTestMail;
use App\Modules\System\Infrastructure\Models\ErrorEvent;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Tests\TestCase;

/**
 * G1b: error log, failed jobs and mail test endpoints.
 */
class OperationsEndpointsTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->admin = User::factory()->platformAdmin()->create();
        $this->actingAsUser($this->admin);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function errorEvent(array $attributes = []): ErrorEvent
    {
        return ErrorEvent::query()->create($attributes + [
            'fingerprint' => hash('sha256', Str::random()),
            'exception_class' => 'RuntimeException',
            'message' => 'Something broke',
            'file' => 'app/Modules/Sales/Thing.php',
            'line' => 42,
            'trace' => '#0 app/Modules/Sales/Thing.php(42): Thing->run()',
            'occurrences' => 1,
            'first_seen_at' => now()->subDay(),
            'last_seen_at' => now(),
            'last_method' => 'POST',
            'last_path' => '/api/v1/pos/checkout',
            'last_request_id' => 'req-12345678',
            'status' => 'open',
        ]);
    }

    private function failedJob(string $exception, string $failedAt): string
    {
        $uuid = (string) Str::uuid();
        DB::table('failed_jobs')->insert([
            'uuid' => $uuid,
            'connection' => 'database',
            'queue' => 'default',
            'payload' => json_encode([
                'uuid' => $uuid,
                'displayName' => QueueHeartbeat::class,
                'job' => 'Illuminate\\Queue\\CallQueuedHandler@call',
                'maxTries' => 1,
                'data' => ['commandName' => QueueHeartbeat::class, 'command' => serialize(new QueueHeartbeat)],
                'customer_secret' => 'jane@example.com',
            ]),
            'exception' => $exception,
            'failed_at' => $failedAt,
        ]);

        return $uuid;
    }

    public function test_error_list_filters_searches_and_sorts_without_trace(): void
    {
        $often = $this->errorEvent(['message' => 'Often', 'occurrences' => 50, 'last_seen_at' => now()->subHour()]);
        $recent = $this->errorEvent(['message' => 'Recent', 'exception_class' => 'LogicException', 'occurrences' => 2]);
        $resolved = $this->errorEvent(['message' => 'Done', 'status' => 'resolved']);
        $this->errorEvent(['message' => 'Muted', 'status' => 'ignored']);

        $this->getJson('/api/v1/platform/system/errors')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('meta.counts', ['open' => 2, 'resolved' => 1, 'ignored' => 1])
            ->assertJsonPath('data.0.id', $recent->id)
            ->assertJsonPath('data.1.id', $often->id)
            ->assertJsonMissingPath('data.0.trace');

        $this->getJson('/api/v1/platform/system/errors?sort=-occurrences')->assertJsonPath('data.0.id', $often->id);
        $this->getJson('/api/v1/platform/system/errors?search=logicexc')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.id', $recent->id);
        $this->getJson('/api/v1/platform/system/errors?status=resolved')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.id', $resolved->id);
        $this->getJson('/api/v1/platform/system/errors?status=bogus')->assertUnprocessable();
    }

    public function test_error_detail_and_status_changes(): void
    {
        $event = $this->errorEvent();

        $this->getJson("/api/v1/platform/system/errors/{$event->id}")
            ->assertOk()
            ->assertJsonPath('data.trace', '#0 app/Modules/Sales/Thing.php(42): Thing->run()')
            ->assertJsonPath('data.last_path', '/api/v1/pos/checkout')
            ->assertJsonPath('data.last_request_id', 'req-12345678');

        $this->patchJson("/api/v1/platform/system/errors/{$event->id}", ['status' => 'resolved'])
            ->assertOk()
            ->assertJsonPath('data.status', 'resolved')
            ->assertJsonPath('data.resolved_by', $this->admin->id);
        $this->assertNotNull($event->fresh()->resolved_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.error_status_changed', 'subject_id' => $event->id, 'user_id' => $this->admin->id]);

        $this->patchJson("/api/v1/platform/system/errors/{$event->id}", ['status' => 'open'])
            ->assertOk()->assertJsonPath('data.status', 'open')->assertJsonPath('data.resolved_at', null);
        $this->patchJson("/api/v1/platform/system/errors/{$event->id}", ['status' => 'ignored'])->assertOk()->assertJsonPath('data.status', 'ignored');
        $this->patchJson("/api/v1/platform/system/errors/{$event->id}", ['status' => 'gone'])->assertUnprocessable();

        $this->getJson('/api/v1/platform/system/errors/'.Str::uuid())->assertNotFound();
        $this->getJson('/api/v1/platform/system/errors/not-a-uuid')->assertNotFound();
    }

    public function test_failed_jobs_list_newest_first_without_payload(): void
    {
        $older = $this->failedJob("RuntimeException: Card 4111111111111111 declined for jane@example.com in /app/X.php:12\nStack trace:\n#0 ...", now()->subHour()->format('Y-m-d H:i:s'));
        $newer = $this->failedJob('Illuminate\\Queue\\MaxAttemptsExceededException: too many attempts', now()->format('Y-m-d H:i:s'));

        $response = $this->getJson('/api/v1/platform/system/failed-jobs')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('data.0.uuid', $newer)
            ->assertJsonPath('data.1.uuid', $older)
            ->assertJsonPath('data.1.job', QueueHeartbeat::class)
            ->assertJsonPath('data.1.queue', 'default')
            ->assertJsonPath('data.1.connection', 'database')
            ->assertJsonPath('data.1.exception', 'RuntimeException: Card [number] declined for [email] in /app/X.php:12')
            ->assertJsonStructure(['data' => ['*' => ['id', 'uuid', 'job', 'queue', 'connection', 'failed_at', 'exception']]]);

        $this->assertStringNotContainsString('payload', $response->getContent());
        $this->assertStringNotContainsString('customer_secret', $response->getContent());
        $this->assertStringNotContainsString('jane@example.com', $response->getContent());
    }

    public function test_failed_job_retry_delete_and_retry_all(): void
    {
        $first = $this->failedJob('RuntimeException: a', now()->format('Y-m-d H:i:s'));
        $second = $this->failedJob('RuntimeException: b', now()->format('Y-m-d H:i:s'));
        $third = $this->failedJob('RuntimeException: c', now()->format('Y-m-d H:i:s'));

        $this->postJson("/api/v1/platform/system/failed-jobs/{$first}/retry")
            ->assertOk()->assertJsonPath('data', ['uuid' => $first, 'retried' => true]);
        $this->assertDatabaseMissing('failed_jobs', ['uuid' => $first]);
        $this->assertSame(1, DB::table('jobs')->count(), 'pushed back onto its (database) queue');
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.failed_job_retried', 'user_id' => $this->admin->id]);

        $this->deleteJson("/api/v1/platform/system/failed-jobs/{$second}")
            ->assertOk()->assertJsonPath('data', ['uuid' => $second, 'deleted' => true]);
        $this->assertDatabaseMissing('failed_jobs', ['uuid' => $second]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.failed_job_deleted', 'user_id' => $this->admin->id]);
        $this->assertSame(1, DB::table('jobs')->count());

        $this->postJson("/api/v1/platform/system/failed-jobs/{$second}/retry")->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
        $this->deleteJson("/api/v1/platform/system/failed-jobs/{$second}")->assertNotFound();

        $this->failedJob('RuntimeException: d', now()->format('Y-m-d H:i:s'));
        $this->postJson('/api/v1/platform/system/failed-jobs/retry-all')->assertOk()->assertJsonPath('data.retried', 2);
        $this->assertSame(0, DB::table('failed_jobs')->count());
        $this->assertSame(3, DB::table('jobs')->count());
        $this->assertDatabaseMissing('failed_jobs', ['uuid' => $third]);
    }

    public function test_mail_test_sends_synchronously(): void
    {
        Mail::fake();

        $this->postJson('/api/v1/platform/system/mail-test', ['to' => 'ops@example.com'])
            ->assertOk()->assertJsonPath('data.sent', true);

        Mail::assertSent(SystemTestMail::class, fn (SystemTestMail $mail) => $mail->hasTo('ops@example.com'));
        Mail::assertNothingQueued();
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.mail_test', 'user_id' => $this->admin->id]);

        $this->postJson('/api/v1/platform/system/mail-test', ['to' => 'not-an-email'])->assertUnprocessable();
    }

    public function test_mail_test_failure_is_reported_sanitised(): void
    {
        Mail::extend('g1b-failing', fn () => new class extends AbstractTransport
        {
            protected function doSend(SentMessage $message): void
            {
                throw new TransportException('Failed to authenticate on SMTP server with username "mailer@example.com" using password=hunter2: 535 Incorrect authentication data');
            }

            public function __toString(): string
            {
                return 'g1b-failing';
            }
        });
        config(['mail.mailers.g1b-failing' => ['transport' => 'g1b-failing'], 'mail.default' => 'g1b-failing']);

        $response = $this->postJson('/api/v1/platform/system/mail-test', ['to' => 'ops@example.com'])
            ->assertUnprocessable()
            ->assertJsonPath('error.code', 'MAIL_FAILED');

        $message = $response->json('error.message');
        $this->assertStringContainsString('Failed to authenticate on SMTP server', $message);
        $this->assertStringNotContainsString('hunter2', $message);
        $this->assertStringNotContainsString('mailer@example.com', $message);
        $audit = DB::table('audit_logs')->where('action', 'system.mail_test')->first();
        $this->assertFalse(json_decode($audit->context, true)['sent']);
        $this->assertStringNotContainsString('hunter2', $audit->context);
    }

    public function test_mail_test_is_throttled(): void
    {
        Mail::fake();

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/v1/platform/system/mail-test', ['to' => 'ops@example.com'])->assertOk();
        }
        $this->postJson('/api/v1/platform/system/mail-test', ['to' => 'ops@example.com'])->assertStatus(429);
    }
}
