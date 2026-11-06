<?php

namespace App\Modules\Purchasing\Domain\Procurement;

/**
 * draft → submitted → approved → converted (every line turned into purchase orders / RFQs);
 * submitted → rejected; draft/submitted → cancelled (requester), also approved → cancelled
 * (purchases.manage) while nothing was converted. Submitting at or below the auto-approve
 * limit goes straight to approved.
 */
enum RequisitionStatus: string
{
    case Draft = 'draft';
    case Submitted = 'submitted';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case Cancelled = 'cancelled';
    case Converted = 'converted';
}
