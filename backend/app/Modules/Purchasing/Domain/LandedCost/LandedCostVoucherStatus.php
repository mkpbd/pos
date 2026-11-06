<?php

namespace App\Modules\Purchasing\Domain\LandedCost;

/**
 * SC3: a landed cost voucher is edited as a draft and posted once (no void in SC3).
 */
enum LandedCostVoucherStatus: string
{
    case Draft = 'draft';
    case Posted = 'posted';
}
