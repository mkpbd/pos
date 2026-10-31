<?php

namespace App\Modules\Shared\Infrastructure\Persistence\Concerns;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * Tenant isolation for organization-owned models.
 *
 * - While an organization is in context, every query is filtered by it.
 * - New rows are stamped with the context organization; writing a row for a
 *   different organization than the one in context is refused.
 *
 * @mixin Model
 */
trait BelongsToOrganization
{
    public static function bootBelongsToOrganization(): void
    {
        static::addGlobalScope('organization', function (Builder $query) {
            $context = app(TenantContext::class);

            if ($context->hasOrganization()) {
                $query->where($query->qualifyColumn('organization_id'), $context->organizationId());
            }
        });

        static::creating(function (Model $model) {
            $context = app(TenantContext::class);

            if (! $context->hasOrganization()) {
                return;
            }

            $model->organization_id ??= $context->organizationId();

            if ($model->organization_id !== $context->organizationId()) {
                throw new LogicException('Refusing to create a record for another organization.');
            }
        });
    }
}
