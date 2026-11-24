<?php

namespace App\Modules\System\Infrastructure\Console;

use App\Modules\System\Infrastructure\Jobs\QueueHeartbeat;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

/**
 * G1b: scheduled every minute — proves the scheduler runs, and queues a tiny job that proves a
 * queue worker runs (System status → scheduler / queue).
 */
class HeartbeatCommand extends Command
{
    public const SCHEDULER_KEY = 'system:heartbeat:scheduler';

    protected $signature = 'pos:heartbeat';

    protected $description = 'Record the scheduler heartbeat and queue the queue-worker heartbeat';

    public function handle(): int
    {
        Cache::put(self::SCHEDULER_KEY, now()->toIso8601String(), 86400);
        QueueHeartbeat::dispatch();

        return self::SUCCESS;
    }
}
