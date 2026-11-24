<?php

namespace App\Modules\System\Infrastructure\Console;

use App\Modules\System\Infrastructure\Performance\PerfDataSeeder;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Throwable;

/**
 * G1c: fills the current (development / testing) database with production-sized data for
 * `pos:perf:explain`. Never in production. Run `migrate:fresh --seed` first.
 */
class PerfSeedCommand extends Command
{
    protected $signature = 'pos:perf:seed
        {--scale=1 : Volume multiplier; 1 = 50 000 products, 600 000 sales (2 000 000 lines), 150 000 web orders, 3 000 000 stock movements}
        {--small=3 : Small organizations to add beside the large one}';

    protected $description = 'Development only: bulk-load production-sized data for performance checks (pos:perf:explain)';

    public function handle(PerfDataSeeder $seeder): int
    {
        if ($this->laravel->isProduction()) {
            $this->error('pos:perf:seed never runs in production.');

            return self::FAILURE;
        }
        $scale = (float) $this->option('scale');
        if ($scale <= 0 || $scale > 4) {
            $this->error('--scale must be above 0 and at most 4.');

            return self::FAILURE;
        }

        $started = microtime(true);
        $this->info('Seeding performance data into database "'.config('database.connections.'.config('database.default').'.database').'"…');
        try {
            $result = $seeder->seed($scale, max(0, (int) $this->option('small')), fn (string $line) => $this->line($line));
        } catch (Throwable $e) {
            $this->error(mb_strimwidth(explode('(Connection:', $e->getMessage())[0], 0, 1500, '…'));

            return self::FAILURE;
        }

        $refresh = microtime(true);
        Artisan::call('storefront:refresh-product-stats', ['--organization' => $result['organization_id']]);
        $this->line(sprintf('  %-48s %7.1f s', 'product stats (storefront:refresh-product-stats)', microtime(true) - $refresh));

        $this->table(['Table (large organization)', 'Rows'], array_map(fn ($table, $rows) => [$table, number_format($rows)], array_keys($result['counts']), $result['counts']));
        $this->info(sprintf('Done in %.1f s. Organization %s; sign in as %s / %s.', microtime(true) - $started, $result['organization_id'], PerfDataSeeder::OWNER_EMAIL, PerfDataSeeder::PASSWORD));

        return self::SUCCESS;
    }
}
