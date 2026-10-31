<?php

namespace App\Modules\Branches\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Actions\CreateBranch;
use App\Modules\Branches\Application\Actions\UpdateBranch;
use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Branches\Presentation\Http\Requests\SaveBranchRequest;
use App\Modules\Branches\Presentation\Http\Resources\BranchResource;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class BranchController
{
    /**
     * List branches
     *
     * Only branches the user may access. Filter with `is_active`; `search` matches code and name.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['is_active' => ['sometimes', 'boolean']]);
        $accessible = $this->user($request)->accessibleBranchIds();

        $query = Branch::query()
            ->with('stores')
            ->when($accessible !== null, fn (Builder $q) => $q->whereKey($accessible))
            ->when($request->has('is_active'), fn (Builder $q) => $q->where('is_active', $request->boolean('is_active')));

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['code', 'name', 'created_at'], searchable: ['code', 'name'], defaultSort: 'name'),
            BranchResource::class,
        );
    }

    public function store(SaveBranchRequest $request, CreateBranch $createBranch): JsonResponse
    {
        $branch = $createBranch($request->validated());

        return ApiResponse::created(new BranchResource($branch->load('stores')));
    }

    public function show(Request $request, Branch $branch): JsonResponse
    {
        $this->assertAccessible($request, $branch);

        return ApiResponse::success(new BranchResource($branch->load('stores')));
    }

    public function update(SaveBranchRequest $request, Branch $branch, UpdateBranch $updateBranch): JsonResponse
    {
        $this->assertAccessible($request, $branch);
        $branch = $updateBranch($branch, $request->validated());

        return ApiResponse::success(new BranchResource($branch->load('stores')));
    }

    private function assertAccessible(Request $request, Branch $branch): void
    {
        // Branches outside the user's assignment are reported as missing, not forbidden.
        if (! $this->user($request)->canAccessBranch($branch->id)) {
            throw new NotFoundHttpException;
        }
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
