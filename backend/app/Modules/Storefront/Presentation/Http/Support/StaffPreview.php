<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\Request;

/**
 * Draft previews on the store (B1 pages, B3 theme): `?preview=draft` from a signed-in, active
 * staff member of this store's organization holding storefront.view. Everyone else gets the
 * published content.
 */
final class StaffPreview
{
    public static function draft(Request $request): bool
    {
        return $request->query('preview') === 'draft' && self::canViewStorefront($request);
    }

    public static function canViewStorefront(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof TenantUser
            && $user->isActive()
            && $user->organizationId() === ($request->attributes->get(ResolveStorefront::ATTRIBUTE)['organization_id'] ?? null)
            && $user->can('storefront.view');
    }
}
