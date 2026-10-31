<?php

namespace App\Modules\Users\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

class PermissionController
{
    /**
     * Permission catalog
     *
     * Every assignable permission, grouped by module.
     */
    public function index(PermissionRegistry $registry): JsonResponse
    {
        $groups = [];
        foreach ($registry->all() as $name => $meta) {
            $groups[$meta['module']][] = ['name' => $name, 'description' => $meta['description']];
        }
        ksort($groups);

        return ApiResponse::success(array_map(
            fn (string $module, array $permissions) => ['module' => $module, 'permissions' => $permissions],
            array_keys($groups),
            array_values($groups),
        ));
    }
}
