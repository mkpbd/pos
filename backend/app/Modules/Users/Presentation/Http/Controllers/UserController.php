<?php

namespace App\Modules\Users\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Actions\CreateUser;
use App\Modules\Users\Application\Actions\UpdateUser;
use App\Modules\Users\Application\DTOs\UserData;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Infrastructure\Models\User;
use App\Modules\Users\Presentation\Http\Requests\StoreUserRequest;
use App\Modules\Users\Presentation\Http\Requests\UpdateUserRequest;
use App\Modules\Users\Presentation\Http\Resources\UserResource;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class UserController
{
    /**
     * List users
     *
     * Filters: `status`, `role_id`, `branch_id`; `search` matches name and email.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(UserStatus::class)],
            'role_id' => ['sometimes', 'uuid'],
            'branch_id' => ['sometimes', 'uuid'],
        ]);

        $query = User::query()
            ->with(['roles', 'branchMemberships'])
            ->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status))
            ->when($request->query('role_id'), fn (Builder $q, string $roleId) => $q->whereHas('roles', fn (Builder $r) => $r->whereKey($roleId)))
            ->when($request->query('branch_id'), fn (Builder $q, string $branchId) => $q->whereHas('branchMemberships', fn (Builder $b) => $b->where('branch_id', $branchId)));

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['name', 'email', 'created_at', 'last_login_at'], searchable: ['name', 'email'], defaultSort: 'name'),
            UserResource::class,
        );
    }

    public function store(StoreUserRequest $request, CreateUser $createUser): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();
        $user = $createUser(UserData::fromArray($request->validated()), $actor);

        return ApiResponse::created(new UserResource($user->load(['roles', 'branchMemberships'])));
    }

    public function show(User $user): JsonResponse
    {
        return ApiResponse::success(new UserResource($user->load(['roles', 'branchMemberships'])));
    }

    public function update(UpdateUserRequest $request, User $user, UpdateUser $updateUser): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();
        $user = $updateUser($user, $request->validated(), $actor);

        return ApiResponse::success(new UserResource($user->load(['roles', 'branchMemberships'])));
    }
}
