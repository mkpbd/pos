<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Turns down a pending return; its reserved quantities become returnable again.
 */
class RejectSaleReturn
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(TenantUser $actor, SaleReturn $return, string $reason): SaleReturn
    {
        if (! $actor->canAccessBranch($return->branch_id)) {
            throw new NotFoundHttpException;
        }

        return DB::transaction(function () use ($actor, $return, $reason) {
            /** @var SaleReturn $locked */
            $locked = SaleReturn::query()->whereKey($return->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== ReturnStatus::Pending) {
                throw new BusinessRuleViolation('RETURN_ALREADY_DECIDED', "{$locked->number} is already {$locked->status->value}.");
            }

            $locked->update([
                'status' => ReturnStatus::Rejected,
                'decided_by' => $actor->getAuthIdentifier(),
                'decided_at' => now(),
                'rejection_reason' => $reason,
            ]);
            $this->audit->record('sale_return.rejected', $locked, old: ['status' => ReturnStatus::Pending->value], new: [
                'status' => ReturnStatus::Rejected->value,
                'number' => $locked->number,
                'reason' => $reason,
            ]);

            return $locked;
        });
    }
}
