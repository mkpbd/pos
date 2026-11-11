<?php

namespace App\Modules\Shared\Tests\Concerns;

use Illuminate\Foundation\Testing\DatabaseTruncation;

/**
 * For PostgreSQL tests that must commit (a second connection plays the competing request), so
 * they cannot run inside RefreshDatabase's rolled-back transaction.
 *
 * Plain DatabaseTruncation is not enough when these tests run in the same suite as
 * RefreshDatabase tests: it would wipe the reference rows the migrations insert (geography),
 * and it cleans up only before a test, so the rows this test commits would leak into every
 * transactional test that runs after it. This keeps the reference tables and truncates again
 * once the test is done.
 */
trait TruncatesCommittedData
{
    use DatabaseTruncation;

    /** Tables whose rows come from the migrations themselves. */
    protected array $exceptTables = ['migrations', 'geo_divisions', 'geo_districts'];

    protected function beforeTruncatingDatabase(): void
    {
        $this->beforeApplicationDestroyed(fn () => $this->truncateTablesForAllConnections());
    }
}
