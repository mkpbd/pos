<?php

namespace App\Modules\Reviews\Domain;

/**
 * pending (new or edited, waiting for staff) → approved (shown on the product page) |
 * rejected (hidden, with an optional reason for the author). Editing sends it back to pending.
 */
enum ReviewStatus: string
{
    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';

    public function label(): string
    {
        return match ($this) {
            self::Pending => 'Pending',
            self::Approved => 'Published',
            self::Rejected => 'Rejected',
        };
    }
}
