<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: one target of a post: waiting, being published (claimed by a worker), published, failed.
 */
enum TargetStatus: string
{
    case Pending = 'pending';
    case Publishing = 'publishing';
    case Published = 'published';
    case Failed = 'failed';
}
