<?php

namespace App\Modules\Cart\Infrastructure\Console;

use App\Modules\Cart\Infrastructure\Models\Cart;
use Illuminate\Console\Command;

/**
 * Deletes guest carts that nobody touched for 30 days (their lines go with them).
 * Customer carts never expire. Scheduled daily.
 */
class PruneCartsCommand extends Command
{
    protected $signature = 'cart:prune';

    protected $description = 'Delete expired guest carts';

    public function handle(): int
    {
        $deleted = 0;
        Cart::query()->withoutGlobalScope('organization')
            ->whereNull('customer_id')
            ->where('expires_at', '<=', now())
            ->chunkById(500, function ($carts) use (&$deleted) {
                $deleted += Cart::query()->withoutGlobalScope('organization')->whereKey($carts->modelKeys())->delete();
            });

        $this->info("Deleted {$deleted} expired guest cart(s).");

        return self::SUCCESS;
    }
}
