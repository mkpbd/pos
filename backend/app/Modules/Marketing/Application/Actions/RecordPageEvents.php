<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Application\Contracts\PageInsightDocuments;
use App\Modules\Marketing\Application\Support\DailyVisitorHash;
use App\Modules\Marketing\Domain\BotUserAgents;
use App\Modules\Marketing\Domain\WebVitals;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * B15: one beacon from a store builder page — folded into the day's counts (organization time
 * zone) for the page, its sections, their click grids and the Web Vitals histograms. No event
 * is stored, and nothing personal: unique visitors are counted with the P2a daily salted hash
 * (DailyVisitorHash), kept two days. Bots (user agent list) never count.
 *
 * The document must be a tracked page of the store that is published now, and `version` one of
 * its published versions; events about nodes that are not top-level sections of that version,
 * unknown event types, clicks without a position inside the section and implausible vitals are
 * ignored (counted in `ignored`), as are events beyond the 50th. `seq` 0 (the first beacon of a
 * page view) counts the page view and the visitor; `scroll` counts each milestone above
 * `scroll_from` once. Counts are upserted with `INSERT … ON CONFLICT … DO UPDATE` (concurrent
 * beacons never lose an increment).
 *
 * B13: `arms: {<test id>: A|B}` — the A/B test versions the page view shows (sent with every
 * beacon of it): for each test running in that version of the page, the page view, the unique
 * visitor (the same daily hash, per version), the views and clicks of the version's sections and
 * whether the beacon had a click on them go to builder_experiment_stats.
 */
class RecordPageEvents
{
    public const MAX_EVENTS = 50;

    public const GRID = 20;

    public const SCROLL_MILESTONES = [25, 50, 75, 100];

    /** B13: the A/B test versions a beacon may name. */
    public const MAX_ARMS = 3;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly PageInsightDocuments $documents,
    ) {}

    /**
     * @param  array{document_id: string, version: int, device: string, seq: int, events?: list<mixed>|null,
     *   scroll?: int|null, scroll_from?: int|null, vitals?: array<string, mixed>|null}  $beacon  validated
     * @return array{recorded: bool, accepted: int, ignored: int}
     */
    public function __invoke(array $beacon, ?string $ip, ?string $userAgent): array
    {
        $events = array_values($beacon['events'] ?? []);
        $ignored = max(0, count($events) - self::MAX_EVENTS);
        $events = array_slice($events, 0, self::MAX_EVENTS);
        $none = ['recorded' => false, 'accepted' => 0, 'ignored' => $ignored + count($events)];
        if (BotUserAgents::isBot($userAgent)) {
            return $none;
        }
        $documentId = strtolower($beacon['document_id']);
        $nodes = $this->documents->trackableSections($documentId, (int) $beacon['version']);
        if ($nodes === null) {
            return $none;
        }
        $known = array_flip($nodes);

        $views = [];
        $clicks = [];
        $cells = [];
        foreach ($events as $event) {
            $node = is_array($event) ? ($event['node'] ?? null) : null;
            if (! is_string($node) || ! isset($known[$node])) {
                $ignored++;

                continue;
            }
            $type = $event['t'] ?? null;
            if ($type === 'view' && ! isset($views[$node])) {
                $views[$node] = 1;
            } elseif ($type === 'click' && ($cell = self::cell($event['x'] ?? null, $event['y'] ?? null)) !== null) {
                $clicks[$node] = ($clicks[$node] ?? 0) + 1;
                $key = $node.'|'.$cell[0].'|'.$cell[1];
                $cells[$key] = ($cells[$key] ?? 0) + 1;
            } else {
                $ignored++;
            }
        }

        $pageView = (int) $beacon['seq'] === 0;
        $scroll = (int) ($beacon['scroll'] ?? 0);
        $from = (int) ($beacon['scroll_from'] ?? 0);
        $milestones = array_values(array_filter(self::SCROLL_MILESTONES, fn (int $m) => $m > $from && $m <= $scroll));
        $vitals = [];
        foreach (WebVitals::METRICS_LIST as $metric) {
            $raw = $beacon['vitals'][$metric === 'cls' ? 'cls' : $metric.'_ms'] ?? null;
            if ($raw !== null && ($bucket = WebVitals::bucket($metric, $raw)) !== null) {
                $vitals[$metric] = $bucket;
            }
        }
        $accepted = count($views) + array_sum($clicks);
        if (! $pageView && $accepted === 0 && $milestones === [] && $vitals === []) {
            return ['recorded' => false, 'accepted' => 0, 'ignored' => $ignored];
        }

        $organizationId = $this->tenant->requireOrganization();
        $timezone = (string) ($this->organizations->summary($organizationId)['timezone'] ?? config('app.timezone'));
        $day = CarbonImmutable::now($timezone)->toDateString();
        $device = $beacon['device'];
        $key = ['organization_id' => $organizationId, 'document_id' => $documentId, 'day' => $day, 'device' => $device];
        // B13: the A/B test versions this page view shows.
        $arms = $this->arms($beacon['arms'] ?? null, $documentId, (int) $beacon['version'], $pageView, $views, $clicks);

        DB::transaction(function () use ($key, $pageView, $milestones, $views, $clicks, $cells, $vitals, $ip, $userAgent, $arms) {
            foreach ($arms as $row) {
                $armKey = $key + ['experiment_id' => $row['experiment_id'], 'arm' => $row['arm']];
                $unique = ! $pageView ? 0 : DB::table('builder_experiment_visitor_hashes')->insertOrIgnore($armKey + [
                    'hash' => DailyVisitorHash::of($key['day'], $ip, $userAgent),
                ]);
                $this->increment('builder_experiment_stats', [$armKey + [
                    'views' => $pageView ? 1 : 0,
                    'visitors' => $unique > 0 ? 1 : 0,
                    'section_views' => $row['section_views'],
                    'clicks' => $row['clicks'],
                    'clicked_views' => $row['clicks'] > 0 ? 1 : 0,
                    'add_to_carts' => 0,
                ]], array_keys($armKey), ['views', 'visitors', 'section_views', 'clicks', 'clicked_views']);
            }

            if ($pageView || $milestones !== []) {
                $unique = ! $pageView ? 0 : DB::table('builder_visitor_hashes')->insertOrIgnore($key + [
                    'hash' => DailyVisitorHash::of($key['day'], $ip, $userAgent),
                ]);
                $row = $key + ['views' => $pageView ? 1 : 0, 'unique_visitors' => $unique > 0 ? 1 : 0];
                foreach (self::SCROLL_MILESTONES as $m) {
                    $row['scroll_'.$m] = in_array($m, $milestones, true) ? 1 : 0;
                }
                $this->increment('builder_page_stats', [$row], array_keys($key), array_keys(array_diff_key($row, $key)));
            }

            $sections = [];
            foreach (array_keys($views + $clicks) as $node) {
                $sections[] = $key + ['node_id' => $node, 'views' => $views[$node] ?? 0, 'clicks' => $clicks[$node] ?? 0];
            }
            $this->increment('builder_section_stats', $sections, [...array_keys($key), 'node_id'], ['views', 'clicks']);

            $grid = [];
            foreach ($cells as $cell => $count) {
                [$node, $cx, $cy] = explode('|', $cell);
                $grid[] = $key + ['node_id' => $node, 'cx' => (int) $cx, 'cy' => (int) $cy, 'clicks' => $count];
            }
            $this->increment('builder_click_cells', $grid, [...array_keys($key), 'node_id', 'cx', 'cy'], ['clicks']);

            $histogram = [];
            foreach ($vitals as $metric => $bucket) {
                $histogram[] = $key + ['metric' => $metric, 'bucket' => $bucket, 'samples' => 1];
            }
            $this->increment('builder_vital_buckets', $histogram, [...array_keys($key), 'metric', 'bucket'], ['samples']);
        });

        return ['recorded' => true, 'accepted' => $accepted, 'ignored' => $ignored];
    }

    /**
     * B13: per A/B test version the beacon names (`arms: {<test id>: A|B}`, at most 3) that runs
     * in this version of the page, what to count: views and clicks of the version's sections
     * (the page view and visitor go with `seq` 0). Tests that don't run there, bad arms and
     * versions without anything to count are left out.
     *
     * @param  array<string, int>  $views  node => 1
     * @param  array<string, int>  $clicks  node => clicks
     * @return list<array{experiment_id: string, arm: string, section_views: int, clicks: int}>
     */
    private function arms(mixed $arms, string $documentId, int $version, bool $pageView, array $views, array $clicks): array
    {
        if (! is_array($arms) || $arms === []) {
            return [];
        }
        $running = $this->documents->runningExperiments($documentId, $version);
        $rows = [];
        foreach (array_slice($arms, 0, self::MAX_ARMS, true) as $experiment => $arm) {
            if (! is_string($experiment) || ! in_array($arm, ['A', 'B'], true) || ! isset($running[$experiment])) {
                continue;
            }
            $sections = array_flip($running[$experiment][$arm]);
            $sectionViews = count(array_intersect_key($views, $sections));
            $sectionClicks = array_sum(array_intersect_key($clicks, $sections));
            if ($pageView || $sectionViews > 0 || $sectionClicks > 0) {
                $rows[] = ['experiment_id' => $experiment, 'arm' => $arm, 'section_views' => $sectionViews, 'clicks' => $sectionClicks];
            }
        }

        return $rows;
    }

    /**
     * The 20 × 20 grid cell of a click position (0 … 1 inside the section), or null.
     *
     * @return array{0: int, 1: int}|null
     */
    public static function cell(mixed $x, mixed $y): ?array
    {
        foreach ([$x, $y] as $v) {
            if ((! is_int($v) && ! is_float($v)) || ! is_finite((float) $v) || $v < 0 || $v > 1) {
                return null;
            }
        }

        return [min(self::GRID - 1, (int) floor($x * self::GRID)), min(self::GRID - 1, (int) floor($y * self::GRID))];
    }

    /**
     * Inserts the rows, adding their counts to existing rows with the same key.
     *
     * @param  list<array<string, mixed>>  $rows  one per key
     * @param  list<string>  $keys
     * @param  list<string>  $counts
     */
    private function increment(string $table, array $rows, array $keys, array $counts): void
    {
        if ($rows === []) {
            return;
        }
        $update = [];
        foreach ($counts as $column) {
            $update[$column] = DB::raw("{$table}.{$column} + excluded.{$column}");
        }
        DB::table($table)->upsert($rows, $keys, $update);
    }
}
