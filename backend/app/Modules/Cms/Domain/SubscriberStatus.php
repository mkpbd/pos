<?php

namespace App\Modules\Cms\Domain;

enum SubscriberStatus: string
{
    /** Signed up, confirmation e-mail sent, link not followed yet. */
    case Pending = 'pending';
    case Subscribed = 'subscribed';
    case Unsubscribed = 'unsubscribed';
}
