<?php

namespace App\Modules\Organizations\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Actions\UpdateOrganization;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Organizations\Presentation\Http\Requests\UpdateOrganizationRequest;
use App\Modules\Organizations\Presentation\Http\Resources\OrganizationResource;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The organization of the current tenant context.
 *
 * G1a: for users who may edit it (organization.update), the response carries
 * `two_factor_summary` {users, enabled, required_missing} next to `settings.two_factor_policy`.
 */
class CurrentOrganizationController
{
    public function show(Request $request, TenantContext $tenant): JsonResponse
    {
        return ApiResponse::success((new OrganizationResource($this->current($tenant)))
            ->withSecuritySummary($request->user()->can('organization.update')));
    }

    public function update(UpdateOrganizationRequest $request, TenantContext $tenant, UpdateOrganization $update): JsonResponse
    {
        return ApiResponse::success((new OrganizationResource($update($this->current($tenant), $request->validated())))
            ->withSecuritySummary());
    }

    private function current(TenantContext $tenant): Organization
    {
        return Organization::query()->findOrFail($tenant->requireOrganization());
    }
}
