<?php

namespace App\Modules\System\Infrastructure\Console;

use App\Modules\System\Infrastructure\Performance\PerfScenarios;
use App\Modules\System\Infrastructure\Performance\PlanSummary;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Console\Command;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Throwable;

/**
 * G1c: runs the heavy read paths as real API requests (in process, through the HTTP kernel
 * and every middleware), records each request's SQL, and runs `EXPLAIN (ANALYZE, BUFFERS)`
 * on the slow statements with the bindings they ran with — so what is measured is what
 * production runs. Caches are an in-memory store emptied before every run, so the numbers
 * are cache misses. Never in production (EXPLAIN ANALYZE executes the statements).
 */
class PerfExplainCommand extends Command
{
    protected $signature = 'pos:perf:explain
        {--json : Print the results as JSON}
        {--only= : Comma-separated scenario name prefixes (e.g. dashboard,report.sales)}
        {--runs=3 : Measured runs per request (the median is reported, after one warm-up run)}
        {--threshold=20 : EXPLAIN the statements of a request that took at least this many ms}
        {--plans : Also print the text plan of every explained statement}
        {--organization= : Organization id (default: the pos:perf:seed organization)}';

    protected $description = 'Development only: time the heavy API read paths and EXPLAIN their slow SQL';

    /** Requests slower than this (warm-up run) are measured once instead of --runs times. */
    private const SLOW_MS = 5000;

    public function handle(HttpKernel $kernel): int
    {
        if ($this->laravel->isProduction()) {
            $this->error('pos:perf:explain never runs in production.');

            return self::FAILURE;
        }
        if (DB::getDriverName() !== 'pgsql') {
            $this->error('pos:perf:explain needs PostgreSQL.');

            return self::FAILURE;
        }

        // Cache misses every time, no external calls, no rate limits carried between runs.
        config(['cache.default' => 'array', 'cache.limiter' => 'array', 'session.driver' => 'array', 'ai.enabled' => false, 'app.debug' => true]);

        try {
            $setup = PerfScenarios::build($this->option('organization') ?: null);
        } catch (Throwable $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $users = ['owner' => User::query()->find($setup['owner_id']), 'manager' => $setup['manager_id'] ? User::query()->find($setup['manager_id']) : null];
        $only = array_filter(array_map('trim', explode(',', (string) $this->option('only'))));
        $runs = max(1, (int) $this->option('runs'));
        $threshold = max(0.0, (float) $this->option('threshold'));

        $captured = null;
        DB::listen(function (QueryExecuted $event) use (&$captured) {
            if ($captured !== null) {
                $captured[] = ['sql' => $event->sql, 'bindings' => $event->bindings, 'ms' => (float) $event->time];
            }
        });

        $results = [];
        foreach ($setup['scenarios'] as $scenario) {
            if ($only !== [] && ! array_filter($only, fn (string $prefix) => str_starts_with($scenario['name'], $prefix))) {
                continue;
            }
            $timings = [];
            $status = 0;
            $queries = [];
            $last = $runs;
            for ($run = 0; $run <= $last; $run++) {
                $captured = $run === $last ? [] : null;
                memory_reset_peak_usage();
                [$status, $ms, $error] = $this->dispatch($kernel, $scenario, $users[$scenario['as'] ?? ''] ?? null, $setup['organization_id']);
                if ($run > 0) {
                    $timings[] = $ms;
                } elseif ($ms > self::SLOW_MS) {
                    $last = 1; // A request that slow is measured once after the warm-up.
                }
                if ($run === $last) {
                    $queries = $captured;
                    $peakMb = (int) round(memory_get_peak_usage() / 1048576);
                }
                $captured = null;
            }
            sort($timings);
            $median = $timings[intdiv(count($timings), 2)];
            $results[] = $this->analyse($scenario, $status, $error ?? null, $median, $queries, $threshold) + ['peak_memory_mb' => $peakMb ?? null];
            if (! $this->option('json')) {
                $this->printResult(end($results));
            }
        }

        if ($this->option('json')) {
            $this->line((string) json_encode(['generated_at' => now()->toIso8601String(), 'organization_id' => $setup['organization_id'], 'runs' => $runs, 'results' => $results],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        } else {
            $this->newLine();
            $this->table(['Request', 'HTTP', 'Server ms', 'Target', 'Queries', 'DB ms', 'Slowest SQL ms'], array_map(fn (array $r) => [
                $r['name'], $r['status'], $r['server_ms'].($r['over_target'] ? ' !' : ''), $r['target_ms'], $r['query_count'], $r['db_ms'], $r['slowest_ms'],
            ], $results));
            $over = array_filter($results, fn (array $r) => $r['over_target']);
            $this->line(count($over).' of '.count($results).' over target ("!").');
        }

        return self::SUCCESS;
    }

    /**
     * @param  array<string, mixed>  $scenario
     * @return array{0: int, 1: float, 2: ?string}
     */
    private function dispatch(HttpKernel $kernel, array $scenario, ?User $user, string $organizationId): array
    {
        Cache::flush();
        if ($scenario['reset_insights'] ?? false) {
            DB::table('ai_insights')->where('organization_id', $organizationId)->delete();
        }
        Auth::forgetGuards();
        if ($user !== null) {
            $user = $user->fresh();
            Sanctum::actingAs($user, ['*']);
        }

        $server = ['HTTP_ACCEPT' => 'application/json', 'REMOTE_ADDR' => '127.0.0.1'];
        if ($scenario['host'] !== null) {
            $server['HTTP_HOST'] = $scenario['host'];
        }
        $request = Request::create($scenario['path'], 'GET', $scenario['query'], [], [], $server);

        $started = hrtime(true);
        $response = $kernel->handle($request);
        $ms = (hrtime(true) - $started) / 1e6;
        $kernel->terminate($request, $response);

        $error = null;
        if ($response->getStatusCode() >= 400) {
            $error = mb_strimwidth((string) $response->getContent(), 0, 300, '…');
        }

        return [$response->getStatusCode(), round($ms, 1), $error];
    }

    /**
     * @param  array<string, mixed>  $scenario
     * @param  list<array{sql: string, bindings: array<int|string, mixed>, ms: float}>  $queries
     * @return array<string, mixed>
     */
    private function analyse(array $scenario, int $status, ?string $error, float $serverMs, array $queries, float $threshold): array
    {
        // Group repeated statements (N+1 shapes) by their SQL text.
        $groups = [];
        foreach ($queries as $q) {
            $key = $q['sql'];
            $groups[$key] ??= ['sql' => $q['sql'], 'bindings' => $q['bindings'], 'count' => 0, 'ms' => 0.0, 'max_ms' => 0.0];
            $groups[$key]['count']++;
            $groups[$key]['ms'] += $q['ms'];
            if ($q['ms'] > $groups[$key]['max_ms']) {
                $groups[$key]['max_ms'] = $q['ms'];
                $groups[$key]['bindings'] = $q['bindings'];
            }
        }
        usort($groups, fn (array $a, array $b) => $b['ms'] <=> $a['ms']);

        $explained = [];
        foreach ($groups as $g) {
            if ($g['max_ms'] < $threshold || count($explained) >= 5) {
                break;
            }
            $entry = ['sql' => $g['sql'], 'count' => $g['count'], 'total_ms' => round($g['ms'], 1), 'max_ms' => round($g['max_ms'], 1)];
            if (preg_match('/^\s*(select|with)\b/i', $g['sql'])) {
                try {
                    $entry['plan'] = PlanSummary::explain($g['sql'], $g['bindings'], (bool) $this->option('plans'));
                } catch (Throwable $e) {
                    $entry['plan_error'] = mb_strimwidth($e->getMessage(), 0, 300, '…');
                }
            }
            $explained[] = $entry;
        }

        return [
            'name' => $scenario['name'],
            'request' => 'GET '.$scenario['path'].($scenario['query'] === [] ? '' : '?'.http_build_query($scenario['query'])),
            'status' => $status,
            'error' => $error,
            'server_ms' => $serverMs,
            'target_ms' => $scenario['target'],
            'over_target' => $serverMs > $scenario['target'],
            'query_count' => count($queries),
            'db_ms' => round(array_sum(array_column($queries, 'ms')), 1),
            'slowest_ms' => round((float) max([0, ...array_column($queries, 'ms')]), 1),
            'repeated' => array_values(array_map(fn (array $g) => ['count' => $g['count'], 'total_ms' => round($g['ms'], 1), 'sql' => mb_strimwidth($g['sql'], 0, 200, '…')],
                array_filter($groups, fn (array $g) => $g['count'] >= 5))),
            'explained' => $explained,
        ];
    }

    /**
     * @param  array<string, mixed>  $r
     */
    private function printResult(array $r): void
    {
        $flag = $r['over_target'] ? '<fg=red>OVER</>' : '<fg=green>ok</>';
        $this->line(sprintf('<options=bold>%s</> %s  HTTP %d  server %.1f ms (target %d)  %d queries, DB %.1f ms, peak PHP memory %d MB', $r['name'], $flag, $r['status'], $r['server_ms'], $r['target_ms'], $r['query_count'], $r['db_ms'], $r['peak_memory_mb']));
        if ($r['error'] !== null) {
            $this->line('  error: '.$r['error']);
        }
        foreach ($r['repeated'] as $g) {
            $this->line(sprintf('  repeated %dx (%.1f ms): %s', $g['count'], $g['total_ms'], $g['sql']));
        }
        foreach ($r['explained'] as $e) {
            $this->line(sprintf('  %.1f ms%s  %s', $e['max_ms'], $e['count'] > 1 ? " (x{$e['count']})" : '', mb_strimwidth(preg_replace('/\s+/', ' ', $e['sql']), 0, 160, '…')));
            if (isset($e['plan'])) {
                $p = $e['plan'];
                $this->line(sprintf('    plan: %s, exec %.1f ms, plan %.1f ms, rows est %s / actual %s, buffers hit %s read %s',
                    $p['top'], $p['execution_ms'], $p['planning_ms'], number_format($p['rows_estimated']), number_format($p['rows_actual']), number_format($p['shared_hit']), number_format($p['shared_read'])));
                if ($p['seq_scans'] !== []) {
                    $this->line('    seq scans: '.implode('; ', $p['seq_scans']));
                }
                if ($p['worst_estimate'] !== null) {
                    $this->line('    misestimate: '.$p['worst_estimate']);
                }
                if ($p['text'] !== null) {
                    $this->line(preg_replace('/^/m', '      ', $p['text']));
                }
            } elseif (isset($e['plan_error'])) {
                $this->line('    explain failed: '.$e['plan_error']);
            }
        }
    }
}
