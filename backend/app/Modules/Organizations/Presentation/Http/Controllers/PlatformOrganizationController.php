<?php

namespace App\Modules\Organizations\Presentation\Http\Controllers;

use App\Modules\Organizations\Application\Actions\ProvisionOrganization;
use App\Modules\Organizations\Application\Actions\UpdateOrganization;
use App\Modules\Organizations\Application\DTOs\ProvisionOrganizationData;
use App\Modules\Organizations\Domain\Enums\OrganizationStatus;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Organizations\Presentation\Http\Requests\ProvisionOrganizationRequest;
use App\Modules\Organizations\Presentation\Http\Resources\OrganizationResource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Platform (super admin) management of all organizations.
 */
class PlatformOrganizationController
{
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['sometimes', Rule::enum(OrganizationStatus::class)]]);

        $query = Organization::query()
            ->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status));

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['name', 'created_at'], searchable: ['name', 'slug'], defaultSort: 'name'),
            OrganizationResource::class,
        );
    }

    public function store(ProvisionOrganizationRequest $request, ProvisionOrganization $provision): JsonResponse
    {
        $result = $provision(ProvisionOrganizationData::fromArray($request->validated()));

        return ApiResponse::created(new OrganizationResource($result['organization']));
    }

    public function updateStatus(Request $request, Organization $organization, UpdateOrganization $update): JsonResponse
    {
        $data = $request->validate(['status' => ['required', Rule::enum(OrganizationStatus::class)]]);

        return ApiResponse::success(new OrganizationResource($update($organization, $data)));
    }
}
