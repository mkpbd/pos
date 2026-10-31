<?php

namespace App\Modules\Orders\Infrastructure\Console;

use App\Modules\Orders\Application\Actions\CancelOrder;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Cancels bank-transfer orders whose payment hold ran out (reason `payment_expired`, no
 * actor) and puts their stock back. Each order is taken with FOR UPDATE SKIP LOCKED on
 * PostgreSQL, so parallel runs (or a staff action on the same order) never cancel or
 * restock twice; the status is re-checked under the lock. Scheduled every minute.
 */
class ExpirePendingOrdersCommand extends Command
{
    public const REASON = 'payment_expired';

    protected $signature = 'orders:expire-pending';

    protected $description = 'Cancel web orders whose payment hold expired and restock them';

    public function handle(CancelOrder $cancel, TenantContext $tenant): int
    {
        $due = Order::query()->withoutGlobalScope('organization')
            ->where('status', OrderStatus::PendingPayment->value)
            ->where('expires_at', '<=', now())
            ->orderBy('expires_at')
            ->limit(500)
            ->get(['id', 'organization_id']);

        $expired = 0;
        foreach ($due as $candidate) {
            try {
                $done = $tenant->runAs($candidate->organization_id, fn () => DB::transaction(function () use ($candidate, $cancel) {
                    $query = Order::query()
                        ->whereKey($candidate->id)
                        ->where('status', OrderStatus::PendingPayment->value)
                        ->where('expires_at', '<=', now());
                    /** @var Order|null $order */
                    $order = (DB::getDriverName() === 'pgsql' ? $query->lock('for update skip locked') : $query->lockForUpdate())->first();
                    if ($order === null) {
                        return false; // taken by another run, paid or cancelled meanwhile
                    }
                    $cancel->cancelLocked($order, self::REASON, null);

                    return true;
                }));
            } catch (BusinessRuleViolation $e) {
                report($e);
                $done = false;
            }
            $expired += $done ? 1 : 0;
        }

        $this->info("Cancelled {$expired} expired order(s).");

        return self::SUCCESS;
    }
}
