<?php

namespace App\Modules\Marketing\Infrastructure\Jobs;

use App\Modules\Marketing\Application\Actions\SendMetaPurchase;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Jobs\SyncJob;
use RuntimeException;

/**
 * BD1c: reports a placed order to Meta's Conversions API (SendMetaPurchase). Retryable failures
 * (connection, 429, 5xx) are thrown so the queue tries again (10 s, then 60 s; 3 tries); the
 * last try stores the failure. The payload is encrypted (it names the order and the site). On
 * the sync queue there is one try only.
 */
class SendMetaPurchaseJob implements ShouldBeEncrypted, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [10, 60];

    public int $timeout = 30;

    public function __construct(
        public readonly string $organizationId,
        public readonly string $orderId,
        public readonly string $siteUrl,
    ) {}

    public function handle(SendMetaPurchase $send): void
    {
        $final = $this->job === null || $this->job instanceof SyncJob || $this->attempts() >= $this->tries;
        $result = $send($this->organizationId, $this->orderId, $this->siteUrl, $final);

        if ($result !== null && $result['status'] === 'failed' && $result['retryable'] && ! $final) {
            throw new class('Meta Conversions API failed ('.$result['error'].'); retrying.') extends RuntimeException
            {
                /** Expected and retried: not an application error worth reporting. */
                public function report(): void {}
            };
        }
    }
}
