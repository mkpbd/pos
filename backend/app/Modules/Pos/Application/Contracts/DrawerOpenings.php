<?php

namespace App\Modules\Pos\Application\Contracts;

/**
 * POS1d: no-sale cash drawer openings recorded at the till, for the register session documents
 * (X / Z reports) of the Payments module — which never reads the Pos tables itself. Both methods
 * work in the organization in context.
 */
interface DrawerOpenings
{
    /**
     * How many times the drawer was opened without a sale in each session (sessions without any
     * opening are 0).
     *
     * @param  list<string>  $sessionIds
     * @return array<string, int> session id → count
     */
    public function countForSessions(array $sessionIds): array;

    /**
     * The session's no-sale openings, oldest first.
     *
     * @return list<array{opened_at: string, reason: string, user_name: ?string, approved_by_name: ?string}>
     */
    public function forSession(string $sessionId): array;
}
