<?php

namespace App\Modules\Branches\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Actions\SaveStore;
use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Branches\Presentation\Http\Requests\SaveStoreRequest;
use App\Modules\Branches\Presentation\Http\Resources\StoreResource;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class StoreController
{
    public function index(Request $request, Branch $branch): JsonResponse
    {
        $this->assertAccessible($request, $branch);

        return ApiResponse::success(StoreResource::collection($branch->stores()->orderBy('code')->get()));
    }

    public function store(SaveStoreRequest $request, Branch $branch, SaveStore $saveStore): JsonResponse
    {
        $this->assertAccessible($request, $branch);

        return ApiResponse::created(new StoreResource($saveStore($branch, null, $request->validated())));
    }

    public function update(SaveStoreRequest $request, Branch $branch, Store $store, SaveStore $saveStore): JsonResponse
    {
        $this->assertAccessible($request, $branch);

        return ApiResponse::success(new StoreResource($saveStore($branch, $store, $request->validated())));
    }

    private function assertAccessible(Request $request, Branch $branch): void
    {
        /** @var TenantUser $user */
        $user = $request->user();

        if (! $user->canAccessBranch($branch->id)) {
            throw new NotFoundHttpException;
        }
    }
}
