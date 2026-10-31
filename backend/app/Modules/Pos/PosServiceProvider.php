<?php

namespace App\Modules\Pos;

use App\Modules\Pos\Infrastructure\Models\HeldSale;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Support\Facades\Route;

/**
 * The POS terminal: product grid and scanning, live cart pricing, held carts and the
 * idempotent checkout that hands the cart to the Sales module.
 */
class PosServiceProvider extends ModuleServiceProvider
{
    public function boot(): void
    {
        Route::model('heldSale', HeldSale::class);

        parent::boot();
    }

    protected function permissions(): array
    {
        return [
            'pos.sell' => 'Use the POS terminal: look up products, hold carts and check out sales',
        ];
    }
}
