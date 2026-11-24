<?php

namespace App\Modules\System\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\System\Application\Services\SystemStatus;
use Illuminate\Http\JsonResponse;

/**
 * G1b: operations status for platform admins (the public /health probe stays database + cache only).
 */
class SystemStatusController
{
    public function __invoke(SystemStatus $status): JsonResponse
    {
        return ApiResponse::success($status->snapshot());
    }
}
