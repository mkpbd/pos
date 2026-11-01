<?php

namespace App\Modules\Shared\Infrastructure\Persistence\Concerns;

use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use Illuminate\Database\Eloquent\Model;

/**
 * Models whose rows the public storefront shows: every save or delete bumps the
 * organization's storefront content version after commit, which invalidates the cached
 * storefront read models (E12). Override `affectsStorefront()` to skip writes that cannot
 * change what shoppers see, and `storefrontOrganizationId()` for models not keyed by
 * `organization_id`. Mass updates through the query builder fire no events: callers bump
 * the version themselves.
 *
 * @mixin Model
 */
trait ChangesStorefrontContent
{
    public static function bootChangesStorefrontContent(): void
    {
        $bump = function (Model $model): void {
            /** @var Model&self $model */
            $organizationId = $model->storefrontOrganizationId();
            if (is_string($organizationId) && $organizationId !== '' && $model->affectsStorefront()) {
                app(StorefrontContentVersion::class)->bump($organizationId);
            }
        };

        // A save that changed nothing changes nothing on the storefront either.
        static::saved(fn (Model $model) => $model->wasRecentlyCreated || $model->wasChanged() ? $bump($model) : null);
        static::deleted($bump);
    }

    protected function storefrontOrganizationId(): ?string
    {
        $id = $this->getAttribute('organization_id');

        return is_string($id) ? $id : null;
    }

    protected function affectsStorefront(): bool
    {
        return true;
    }
}
