<?php

namespace App\Modules\System\Infrastructure\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;

/**
 * G1b: dispatched every minute by `pos:heartbeat`; when a worker runs it, the queue is alive.
 */
class QueueHeartbeat implements ShouldQueue
{
    use Queueable;

    public const CACHE_KEY = 'system:heartbeat:queue';

    public int $tries = 1;

    public function handle(): void
    {
        Cache::put(self::CACHE_KEY, now()->toIso8601String(), 86400);
    }
}
