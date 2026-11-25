<?php

namespace App\Modules\Authentication\Application\Contracts;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * POS1a: till PINs for other modules (the Pos module's till users and manager approvals),
 * without them reading the users table. PINs are checked with the PIN lockout (5 wrong in a
 * row lock the PIN for 15 minutes); they are never logged or audited.
 */
interface TillPins
{
    /**
     * Active users of the organization who hold the permission, may work in the branch and have a
     * PIN, by name. Accounts locked after failed password sign-ins (G1a) are left out; a locked PIN
     * is not (the user then sees PIN_LOCKED with the time left).
     *
     * @return list<array{id: string, name: string}>
     */
    public function candidates(string $organizationId, string $branchId, string $permission, ?string $exceptUserId = null): array;

    /**
     * Whether the user is an active user of the organization holding the permission in the branch
     * (PIN not considered).
     */
    public function mayAct(string $organizationId, string $userId, string $branchId, string $permission): bool;

    /**
     * Checks a user's PIN, counting failures.
     *
     * @return array{id: string, name: string}
     *
     * @throws BusinessRuleViolation PIN_NOT_SET, PIN_LOCKED (423, details.retry_after s), PIN_INVALID (details.attempts_left)
     */
    public function verify(string $organizationId, string $userId, string $pin): array;
}
