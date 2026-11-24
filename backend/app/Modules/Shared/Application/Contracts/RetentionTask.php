<?php

namespace App\Modules\Shared\Application\Contracts;

/**
 * ST1: a data-retention step a module adds to `pos:prune-records` (System) without System
 * knowing the module: the module tags its implementation with RetentionTask::TAG in its
 * service provider. The task reads its own retention setting and returns how many records it
 * deleted (or, on a dry run, would delete). A task whose setting is "keep forever" returns null
 * and is left out of the report.
 */
interface RetentionTask
{
    public const TAG = 'pos.retention_tasks';

    /** Name shown in the prune report (e.g. "import_files"). */
    public function name(): string;

    public function prune(bool $dryRun): ?int;
}
