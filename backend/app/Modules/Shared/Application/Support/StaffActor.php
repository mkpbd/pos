<?php

namespace App\Modules\Shared\Application\Support;

use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Support\Facades\Auth;

/**
 * The staff user acting in this request, for author and audit columns (users.id).
 *
 * A storefront request authenticated by the `customer` guard makes that guard the default
 * one, so `Auth::id()` would then be a customer account id; only staff users count.
 */
final class StaffActor
{
    public static function id(): ?string
    {
        $user = Auth::user();

        return $user instanceof TenantUser ? (string) $user->getAuthIdentifier() : null;
    }
}
