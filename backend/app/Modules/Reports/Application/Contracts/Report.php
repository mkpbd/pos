<?php

namespace App\Modules\Reports\Application\Contracts;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Domain\ReportDefinition;

/**
 * One whitelisted report: its definition and the query that runs it. Implementations read
 * other modules' tables read-only (the documented read-model exception), always filtered by
 * the context's organization and branch scope, aggregate in the database (GROUP BY) and never
 * loop over raw document rows in PHP.
 */
interface Report
{
    public function definition(): ReportDefinition;

    public function run(ReportContext $context): ReportResult;
}
