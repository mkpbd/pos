<?php

namespace App\Modules\Users\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Actions\DeleteRole;
use App\Modules\Users\Application\Actions\SaveRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Presentation\Http\Requests\SaveRoleRequest;
use App\Modules\Users\Presentation\Http\Resources\RoleResource;
use Illuminate\Http\JsonResponse;

class RoleController
{
    public function index(): JsonResponse
    {
        $roles = Role::query()
            ->withCount('users')
            ->with('permissions')
            ->orderByRaw('system_key is null')
            ->orderBy('name')
            ->get();

        return ApiResponse::success(RoleResource::collection($roles));
    }

    public function store(SaveRoleRequest $request, SaveRole $saveRole): JsonResponse
    {
        $role = $saveRole(null, $request->validated(), $request->user());

        return ApiResponse::created(new RoleResource($role->load('permissions')->loadCount('users')));
    }

    public function show(Role $role): JsonResponse
    {
        return ApiResponse::success(new RoleResource($role->load('permissions')->loadCount('users')));
    }

    public function update(SaveRoleRequest $request, Role $role, SaveRole $saveRole): JsonResponse
    {
        $role = $saveRole($role, $request->validated(), $request->user());

        return ApiResponse::success(new RoleResource($role->load('permissions')->loadCount('users')));
    }

    public function destroy(Role $role, DeleteRole $deleteRole): JsonResponse
    {
        $deleteRole($role);

        return ApiResponse::noContent();
    }
}
