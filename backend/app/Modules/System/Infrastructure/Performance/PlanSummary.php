<?php

namespace App\Modules\System\Infrastructure\Performance;

use Illuminate\Support\Facades\DB;

/**
 * G1c: runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for one captured statement (with the
 * bindings it ran with) and condenses the plan: execution / planning time, the top node,
 * sequential scans that read many rows, the worst row-estimate error and buffer use.
 */
final class PlanSummary
{
    /** Sequential scans returning or filtering out fewer rows than this are not reported. */
    public const SEQ_SCAN_ROWS = 5_000;

    /**
     * @param  array<int|string, mixed>  $bindings
     * @return array{execution_ms: float, planning_ms: float, top: string, rows_estimated: int, rows_actual: int,
     *               seq_scans: list<string>, worst_estimate: ?string, shared_hit: int, shared_read: int, text: ?string}
     */
    public static function explain(string $sql, array $bindings, bool $withText = false): array
    {
        $json = DB::selectOne('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '.$sql, $bindings);
        $document = json_decode((string) ((array) $json)['QUERY PLAN'], true)[0];
        $root = $document['Plan'];

        $seqScans = [];
        $worst = null;
        $worstFactor = 1.0;
        self::walk($root, function (array $node) use (&$seqScans, &$worst, &$worstFactor) {
            $loops = max(1, (int) ($node['Actual Loops'] ?? 1));
            $actual = (int) ($node['Actual Rows'] ?? 0);
            $read = $actual * $loops + (int) ($node['Rows Removed by Filter'] ?? 0) * $loops;
            if (($node['Node Type'] ?? '') === 'Seq Scan' && $read >= self::SEQ_SCAN_ROWS) {
                $seqScans[] = sprintf('%s (%s rows read%s)', $node['Relation Name'] ?? '?', number_format($read), $loops > 1 ? ", {$loops} loops" : '');
            }
            $estimated = (int) ($node['Plan Rows'] ?? 0);
            if (($node['Actual Loops'] ?? 0) > 0 && max($estimated, $actual) >= 1000) {
                $factor = max($estimated, 1) / max($actual, 1);
                $factor = $factor < 1 ? 1 / $factor : $factor;
                if ($factor > $worstFactor) {
                    $worstFactor = $factor;
                    $worst = sprintf('%s%s: est %s / actual %s', $node['Node Type'], isset($node['Relation Name']) ? ' on '.$node['Relation Name'] : '',
                        number_format($estimated), number_format($actual));
                }
            }
        });

        $text = null;
        if ($withText) {
            $rows = DB::select('EXPLAIN (ANALYZE, BUFFERS) '.$sql, $bindings);
            $text = implode("\n", array_map(fn ($row) => (string) ((array) $row)['QUERY PLAN'], $rows));
        }

        return [
            'execution_ms' => round((float) $document['Execution Time'], 1),
            'planning_ms' => round((float) $document['Planning Time'], 1),
            'top' => $root['Node Type'].(isset($root['Relation Name']) ? ' on '.$root['Relation Name'] : ''),
            'rows_estimated' => (int) $root['Plan Rows'],
            'rows_actual' => (int) $root['Actual Rows'],
            'seq_scans' => $seqScans,
            'worst_estimate' => $worstFactor >= 10 ? $worst : null,
            'shared_hit' => (int) ($root['Shared Hit Blocks'] ?? 0),
            'shared_read' => (int) ($root['Shared Read Blocks'] ?? 0),
            'text' => $text,
        ];
    }

    /**
     * @param  array<string, mixed>  $node
     */
    private static function walk(array $node, callable $visit): void
    {
        $visit($node);
        foreach ($node['Plans'] ?? [] as $child) {
            self::walk($child, $visit);
        }
    }
}
