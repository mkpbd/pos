<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Services\OpsAlerts;
use App\Modules\System\Infrastructure\ErrorLog\ErrorRecorder;
use App\Modules\System\Infrastructure\Notifications\OpsAlertNotification;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

/**
 * G1b: unexpected errors are recorded through the separate `error_log` connection. Both
 * connections run inside the test's transactions (rolled back afterwards); rows written by the
 * recorder are read back through `error_log`.
 */
class ErrorLogRecordingTest extends TestCase
{
    use RefreshDatabase;

    /** @var list<string|null> */
    protected array $connectionsToTransact = [null, ErrorRecorder::CONNECTION];

    protected function setUp(): void
    {
        parent::setUp();

        config(['pos.error_log.enabled' => true, 'pos.ops_alert_emails' => []]);

        Route::middleware('api')->prefix('api/v1/_g1b')->group(function () {
            Route::get('boom', fn () => throw new RuntimeException('Order 1234567 failed for jane@example.com'));
            Route::get('not-found', fn () => abort(404));
            Route::post('invalid', fn () => request()->validate(['name' => 'required']));
            Route::get('rule', fn () => throw new BusinessRuleViolation('SOMETHING', 'Not allowed.'));
            Route::get('missing-model', fn () => User::query()->findOrFail('00000000-0000-0000-0000-000000000000'));
            Route::get('rolled-back', function () {
                DB::transaction(function () {
                    DB::table('cache')->insert(['key' => 'g1b-rolled-back', 'value' => 'x', 'expiration' => time() + 60]);
                    // Recorded while the request's transaction is still open…
                    report(new RuntimeException('Reported inside the transaction'));
                    // …which is then rolled back.
                    throw new RuntimeException('The transaction failed');
                });
            });
            Route::get('query', fn () => DB::transaction(fn () => DB::select('select cast(? as integer) as n', ['secret-value-for-jane@example.com'])));
            Route::get('undefined-column', fn () => DB::transaction(fn () => DB::select('select no_such_column from users where email = ?', ['jane@example.com'])));
        });
    }

    private function events(): Builder
    {
        return DB::connection(ErrorRecorder::CONNECTION)->table('error_events');
    }

    public function test_a_server_error_is_recorded_once_and_counts_occurrences(): void
    {
        $first = $this->getJson('/api/v1/_g1b/boom')->assertStatus(500)->assertJsonPath('error.code', 'SERVER_ERROR');
        $second = $this->getJson('/api/v1/_g1b/boom')->assertStatus(500);

        $this->assertSame(1, $this->events()->count());
        $event = $this->events()->first();
        $this->assertSame(2, (int) $event->occurrences);
        $this->assertSame(RuntimeException::class, $event->exception_class);
        $this->assertSame('Order [number] failed for [email]', $event->message);
        $this->assertSame('open', $event->status);
        $this->assertSame('GET', $event->last_method);
        $this->assertSame('/api/v1/_g1b/boom', $event->last_path);
        $this->assertSame($second->headers->get('X-Request-Id'), $event->last_request_id);
        $this->assertNotSame($first->headers->get('X-Request-Id'), $event->last_request_id);
        $this->assertStringStartsWith('app/Modules/System/Tests/Feature/ErrorLogRecordingTest.php', $event->file);
        $this->assertStringStartsWith('#0 ', $event->trace);
        $this->assertStringNotContainsString(str_replace('\\', '/', base_path()), str_replace('\\', '/', $event->trace));
        $this->assertSame(64, strlen($event->fingerprint));
    }

    public function test_expected_errors_are_not_recorded(): void
    {
        $this->getJson('/api/v1/_g1b/not-found')->assertNotFound();
        $this->postJson('/api/v1/_g1b/invalid', [])->assertUnprocessable();
        $this->getJson('/api/v1/_g1b/rule')->assertUnprocessable()->assertJsonPath('error.code', 'SOMETHING');
        $this->getJson('/api/v1/_g1b/missing-model')->assertNotFound();
        $this->getJson('/api/v1/platform/system/status')->assertUnauthorized();

        $this->assertSame(0, $this->events()->count());
    }

    public function test_an_error_inside_a_rolled_back_transaction_is_still_recorded(): void
    {
        $this->getJson('/api/v1/_g1b/rolled-back')->assertStatus(500);

        $this->assertFalse(DB::table('cache')->where('key', 'g1b-rolled-back')->exists(), 'the request transaction was rolled back');
        $this->assertEqualsCanonicalizing(
            ['Reported inside the transaction', 'The transaction failed'],
            $this->events()->pluck('message')->all(),
        );
    }

    public function test_query_errors_are_stored_without_their_bindings(): void
    {
        $this->getJson('/api/v1/_g1b/query')->assertStatus(500);
        $this->getJson('/api/v1/_g1b/undefined-column')->assertStatus(500);

        $messages = $this->events()->orderBy('message')->pluck('message')->all();
        $this->assertCount(2, $messages);
        $this->assertContains('SQLSTATE[22P02] select cast(? as integer) as n', $messages);
        $undefined = collect($messages)->first(fn ($m) => str_contains($m, 'no_such_column'));
        $this->assertStringContainsString('SQLSTATE[42703] select no_such_column from users where email = ?', $undefined);
        $this->assertStringContainsString('does not exist', $undefined);
        foreach ($messages as $message) {
            $this->assertStringNotContainsString('secret-value', $message);
            $this->assertStringNotContainsString('jane@example.com', $message);
        }
    }

    public function test_a_resolved_error_reopens_when_it_happens_again(): void
    {
        $recorder = app(ErrorRecorder::class);
        $error = new RuntimeException('Payment gateway timed out');

        $recorder->record($error);
        $this->events()->update(['status' => 'resolved', 'resolved_at' => now()]);

        $recorder->record($error);

        $event = $this->events()->first();
        $this->assertSame('open', $event->status);
        $this->assertNull($event->resolved_at);
        $this->assertSame(2, (int) $event->occurrences);
    }

    public function test_alert_mail_goes_out_once_per_fingerprint_per_hour(): void
    {
        Notification::fake();
        config(['pos.ops_alert_emails' => ['ops@example.com']]);
        $recorder = app(ErrorRecorder::class);
        $error = new RuntimeException('Stock sync failed');

        $recorder->record($error);
        Notification::assertSentOnDemandTimes(OpsAlertNotification::class, 1);
        Notification::assertSentOnDemand(OpsAlertNotification::class, function (OpsAlertNotification $n, array $channels, object $notifiable) {
            $id = $this->events()->value('id');

            return $notifiable->routes['mail'] === ['ops@example.com']
                && str_contains($n->subject, 'New error: RuntimeException')
                && in_array('Stock sync failed', $n->lines, true)
                && $n->actionUrl === OpsAlerts::adminUrl("system-status/errors/{$id}");
        });

        // Same error again (still open): no new alert.
        $recorder->record($error);
        // Resolved and back within the hour: still no new alert.
        $this->events()->update(['status' => 'resolved']);
        $recorder->record($error);
        Notification::assertSentOnDemandTimes(OpsAlertNotification::class, 1);

        // Resolved and back after the hour: alerted again.
        $this->travel(61)->minutes();
        $this->events()->update(['status' => 'resolved']);
        $recorder->record($error);
        Notification::assertSentOnDemandTimes(OpsAlertNotification::class, 2);
        Notification::assertSentOnDemand(OpsAlertNotification::class, fn (OpsAlertNotification $n) => str_contains($n->subject, 'Error is back'));
    }

    public function test_at_most_twenty_alerts_per_hour_overall(): void
    {
        Notification::fake();
        config(['pos.ops_alert_emails' => ['ops@example.com']]);
        $recorder = app(ErrorRecorder::class);

        foreach (range('a', 'y') as $letter) {
            $recorder->record(new RuntimeException("Failure kind {$letter}{$letter}"));
        }

        $this->assertSame(25, $this->events()->count());
        Notification::assertSentOnDemandTimes(OpsAlertNotification::class, OpsAlerts::MAX_PER_HOUR);
    }

    public function test_ignored_errors_never_alert(): void
    {
        Notification::fake();
        $recorder = app(ErrorRecorder::class);
        $error = new RuntimeException('Known noisy error');

        $recorder->record($error);
        $this->events()->update(['status' => 'ignored']);
        config(['pos.ops_alert_emails' => ['ops@example.com']]);
        $this->travel(2)->hours();
        $recorder->record($error);

        Notification::assertNothingSent();
        $event = $this->events()->first();
        $this->assertSame('ignored', $event->status);
        $this->assertSame(2, (int) $event->occurrences);
        $this->assertNull($event->notified_at);
    }

    public function test_no_alert_without_recipients(): void
    {
        Notification::fake();
        app(ErrorRecorder::class)->record(new RuntimeException('Nobody is told'));

        Notification::assertNothingSent();
        $this->assertNull($this->events()->value('notified_at'));
    }

    public function test_recording_is_off_when_disabled(): void
    {
        config(['pos.error_log.enabled' => false]);

        $this->getJson('/api/v1/_g1b/boom')->assertStatus(500);

        $this->assertSame(0, $this->events()->count());
    }
}
