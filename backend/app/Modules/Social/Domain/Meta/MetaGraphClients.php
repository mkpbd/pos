<?php

namespace App\Modules\Social\Domain\Meta;

use App\Modules\Social\Domain\SocialMode;

/**
 * P2b: the client for a mode — the sandbox simulation or the live Graph API.
 */
interface MetaGraphClients
{
    public function for(SocialMode $mode): MetaGraphClient;
}
