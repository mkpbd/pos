<?php

namespace App\Modules\Cms\Domain;

/**
 * BD2b: a newsletter campaign is edited as a draft and sent once.
 */
enum CampaignStatus: string
{
    case Draft = 'draft';
    /** Sending started; the background job is mailing the subscribers. */
    case Sending = 'sending';
    case Sent = 'sent';
}
