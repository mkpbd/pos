<?php

namespace App\Modules\Inventory\Domain;

/**
 * ST1: what posting a stocktake does with lines nobody counted — leave their stock alone, or
 * treat them as counted zero (snapshot taken at post time).
 */
enum UncountedPolicy: string
{
    case Ignore = 'ignore';
    case Zero = 'zero';
}
