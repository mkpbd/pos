<?php

namespace App\Modules\Pos\Application\Actions;

use App\Modules\Pos\Infrastructure\Models\HeldSale;
use App\Modules\Sales\Application\Actions\CompleteSale;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * POS checkout: completes the sale and, when the cart was resumed from hold, removes the
 * held cart in the same transaction (so a held cart can never be sold twice).
 */
class Checkout
{
    public function __construct(private readonly CompleteSale $completeSale) {}

    /**
     * @param  array<string, mixed>  $data  validated CheckoutRequest data
     */
    public function __invoke(TenantUser $actor, array $data): Sale
    {
        return DB::transaction(function () use ($actor, $data) {
            if (filled($data['held_sale_id'] ?? null)) {
                // Lock first: a second till resuming the same cart waits and then finds it gone.
                $held = HeldSale::query()->whereKey($data['held_sale_id'])->lockForUpdate()->first();
                if ($held === null || ! $actor->canAccessBranch($held->branch_id)) {
                    throw new BusinessRuleViolation('HELD_SALE_GONE', 'This held sale was already completed or discarded at another till.');
                }
                $held->delete();
            }

            return ($this->completeSale)($actor, $data);
        });
    }
}
