<?php

namespace App\Modules\System\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

/**
 * Liveness/readiness probe. Reports per-dependency status only;
 * failure reasons go to the log, never to the (unauthenticated) caller.
 */
class HealthController
{
    /**
     * System health
     *
     * Returns 200 when every dependency is reachable, 503 otherwise.
     *
     * @unauthenticated
     */
    public function __invoke(): JsonResponse
    {
        $checks = [
            'database' => $this->check('database', fn () => DB::select('select 1')),
            'cache' => $this->check('cache', function () {
                $key = 'health:'.Str::random(8);
                Cache::put($key, true, 10);
                $ok = Cache::pull($key) === true;
                throw_unless($ok, new RuntimeException('Cache round-trip failed.'));
            }),
        ];

        $healthy = ! in_array('fail', $checks, true);

        return ApiResponse::success([
            'status' => $healthy ? 'ok' : 'degraded',
            'checks' => $checks,
            'app' => config('app.name'),
            'environment' => app()->environment(),
            'time' => now()->toIso8601String(),
        ], $healthy ? 200 : 503);
    }

    /**
     * @return 'ok'|'fail'
     */
    private function check(string $name, callable $probe): string
    {
        try {
            $probe();

            return 'ok';
        } catch (Throwable $e) {
            Log::warning("Health check [{$name}] failed.", ['exception' => $e->getMessage()]);

            return 'fail';
        }
    }
}
