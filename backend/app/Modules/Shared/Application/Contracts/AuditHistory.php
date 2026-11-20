<?php

namespace App\Modules\Shared\Application\Contracts;

use Carbon\CarbonImmutable;

/**
 * B16: reads the audit trail of one record (in the organization in context), for timelines such
 * as a store builder page's activity log. Implemented by the Audit module.
 */
interface AuditHistory
{
    /**
     * Newest first: entries of `$subjectType` / `$subjectId` older than `$before` (all when null)
     * whose action starts with `$actionPrefix`, at most `$limit`.
     *
     * @return list<array{id: string, action: string, user_id: ?string, old_values: ?array<string, mixed>, new_values: ?array<string, mixed>, context: ?array<string, mixed>, created_at: CarbonImmutable}>
     */
    public function forSubject(string $subjectType, string $subjectId, ?CarbonImmutable $before, int $limit, string $actionPrefix = ''): array;
}
