<?php

namespace App\Modules\Marketing\Application\Listeners;

use App\Modules\Marketing\Application\Queries\TrackingConfig;
use App\Modules\Marketing\Infrastructure\Jobs\SendMetaPurchaseJob;
use App\Modules\Orders\Application\Events\OrderPlaced;
use Throwable;

/**
 * BD1c: when the organization's Conversions API is ready (on, with a pixel id and a token), a
 * placed web order queues SendMetaPurchaseJob (which skips staff-entered orders). A failure is
 * reported, never thrown — the order stands.
 */
class QueueMetaPurchase
{
    public function __construct(private readonly TrackingConfig $config) {}

    public function handle(OrderPlaced $event): void
    {
        try {
            if (! $this->config->settings($event->organizationId)->capiReady()) {
                return;
            }
            SendMetaPurchaseJob::dispatch($event->organizationId, $event->orderId, $event->siteUrl);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
