<?php

namespace App\Modules\Social\Domain;

/**
 * P2b: `sandbox` simulates Facebook and Instagram (no network call, fake ids); `live` talks to the
 * Meta Graph API with the store's own Meta app.
 */
enum SocialMode: string
{
    case Sandbox = 'sandbox';
    case Live = 'live';
}
