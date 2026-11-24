<?php

namespace App\Modules\Sms\Infrastructure\Jobs;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Sms\Application\Actions\DeliverSmsMessage;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Jobs\SyncJob;
use RuntimeException;
use Throwable;

/**
 * BD1a: sends a queued text message. Retryable gateway failures (connection, 429, 5xx) are
 * thrown so the queue tries again (30 s, then 120 s); the last try marks the message `failed`.
 * The payload is encrypted: for one-time codes it carries the real text (the log keeps it
 * masked). On the sync queue there is one try only.
 */
class SendSmsJob implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [30, 120];

    public int $timeout = 60;

    public function __construct(
        public readonly string $messageId,
        public readonly string $organizationId,
        public readonly ?string $text = null,
    ) {}

    public function handle(TenantContext $tenant, DeliverSmsMessage $deliver): void
    {
        $final = $this->job === null || $this->job instanceof SyncJob || $this->attempts() >= $this->tries;
        $result = $tenant->runAs($this->organizationId, fn () => $deliver($this->messageId, $this->text, $final));

        if ($result !== null && ! $result->ok && $result->retryable && ! $final) {
            throw new class('SMS delivery failed ('.$result->error.'); retrying.') extends RuntimeException
            {
                /** Expected and retried: not an application error worth reporting. */
                public function report(): void {}
            };
        }
    }

    /**
     * The job gave up (e.g. timed out): a message still waiting is marked failed.
     */
    public function failed(?Throwable $exception): void
    {
        app(TenantContext::class)->runAs($this->organizationId, fn () => SmsMessage::query()
            ->whereKey($this->messageId)->where('status', 'queued')
            ->update(['status' => 'failed', 'error' => 'gave_up', 'updated_at' => now()]));
    }
}
