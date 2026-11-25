<?php

namespace App\Modules\Pos\Application\Services;

use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Pos\Infrastructure\Models\PosApproval;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * POS1a: approvals of the organization in context (the tenant scope of PosApproval).
 */
class EloquentTillApprovals implements TillApprovals
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
    ) {}

    public function check(string $approvalId, string $requesterId, string $action, array $details): array
    {
        $approval = Str::isUuid($approvalId) ? PosApproval::query()->find($approvalId) : null;

        if ($approval === null
            || $approval->requester_id !== $requesterId
            || $approval->action !== $action
            || $approval->used_at !== null
            || $approval->expires_at->isPast()
            || ($action === self::PRICE_OVERRIDE && ($approval->details['variant_id'] ?? null) !== ($details['variant_id'] ?? null))
            || ($action === self::RETURN && (($details['sale_id'] ?? null) === null || ($approval->details['sale_id'] ?? null) !== $details['sale_id']))
            || (isset($details['store_id']) && $approval->store_id !== $details['store_id'])
        ) {
            throw self::invalid();
        }

        $names = $this->users->names($this->tenant->requireOrganization(), [$approval->approver_id]);

        return [
            'id' => $approval->id,
            'approver_id' => $approval->approver_id,
            'approver_name' => $names[$approval->approver_id] ?? '',
        ];
    }

    public function consume(string $approvalId, string $saleId): void
    {
        DB::transaction(function () use ($approvalId, $saleId) {
            $approval = Str::isUuid($approvalId) ? PosApproval::query()->lockForUpdate()->find($approvalId) : null;

            if ($approval !== null && $approval->used_at !== null && $approval->sale_id === $saleId) {
                return;
            }
            if ($approval === null || $approval->used_at !== null || $approval->expires_at->isPast()) {
                throw self::invalid();
            }

            $approval->forceFill(['used_at' => now(), 'sale_id' => $saleId])->save();
        });
    }

    public static function invalid(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('APPROVAL_INVALID', 'The manager approval is no longer valid. Ask for approval again.');
    }
}
