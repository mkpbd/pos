<?php

namespace App\Modules\Purchasing\Domain\Procurement;

/**
 * Who must approve a requisition or purchase order, decided by its amount (SC2):
 * none (at or below the auto-approve limit), a manager (`purchases.approve`, up to the
 * manager limit) or a senior approver (`purchases.approve_high`, above it). One approval
 * by an eligible approver completes the document (single-step tiered approval).
 */
enum ApprovalLevel: string
{
    case None = 'none';
    case Manager = 'manager';
    case High = 'high';

    /**
     * Permissions any one of which makes a user eligible to approve at this level. Senior
     * approvers may also approve manager-level documents.
     *
     * @return list<string>
     */
    public function approverPermissions(): array
    {
        return match ($this) {
            self::None => [],
            self::Manager => ['purchases.approve', 'purchases.approve_high'],
            self::High => ['purchases.approve_high'],
        };
    }

    /** The permission the UI names as "who may approve" (null: no approval needed). */
    public function requiredPermission(): ?string
    {
        return match ($this) {
            self::None => null,
            self::Manager => 'purchases.approve',
            self::High => 'purchases.approve_high',
        };
    }
}
