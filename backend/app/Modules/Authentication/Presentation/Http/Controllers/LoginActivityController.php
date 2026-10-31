<?php

namespace App\Modules\Authentication\Presentation\Http\Controllers;

use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use App\Modules\Authentication\Presentation\Http\Resources\LoginActivityResource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoginActivityController
{
    /**
     * My login activity
     */
    public function mine(Request $request): JsonResponse
    {
        $query = LoginActivity::query()->where('user_id', $request->user()->getAuthIdentifier());

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['created_at']),
            LoginActivityResource::class,
        );
    }

    /**
     * Organization login activity
     *
     * Filters: `user_id`, `succeeded`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => ['sometimes', 'uuid'],
            'succeeded' => ['sometimes', 'boolean'],
        ]);

        $query = LoginActivity::query()
            ->when($request->query('user_id'), fn (Builder $q, string $userId) => $q->where('user_id', $userId))
            ->when($request->has('succeeded'), fn (Builder $q) => $q->where('succeeded', $request->boolean('succeeded')));

        return ApiResponse::paginated(
            ListQuery::paginate($query, $request, sortable: ['created_at'], searchable: ['email', 'ip_address']),
            LoginActivityResource::class,
        );
    }
}
