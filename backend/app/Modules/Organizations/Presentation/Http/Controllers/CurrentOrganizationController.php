<?php

namespace App\Modules\Organizations\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Actions\UpdateOrganization;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Organizations\Presentation\Http\Requests\UpdateOrganizationRequest;
use App\Modules\Organizations\Presentation\Http\Resources\OrganizationResource;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * The organization of the current tenant context.
 */
class CurrentOrganizationController
{
    public function show(TenantContext $tenant): JsonResponse
    {
        return ApiResponse::success(new OrganizationResource($this->current($tenant)));
    }

    public function update(UpdateOrganizationRequest $request, TenantContext $tenant, UpdateOrganization $update): JsonResponse
    {
        return ApiResponse::success(new OrganizationResource($update($this->current($tenant), $request->validated())));
    }

    private function current(TenantContext $tenant): Organization
    {
        return Organization::query()->findOrFail($tenant->requireOrganization());
    }
}
