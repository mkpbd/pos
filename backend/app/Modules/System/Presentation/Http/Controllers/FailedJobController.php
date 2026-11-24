<?php

namespace App\Modules\System\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\System\Application\Actions\ManageFailedJobs;
use App\Modules\System\Presentation\Http\Resources\FailedJobResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * G1b: failed queue jobs — list (newest first), retry, delete, retry all.
 */
class FailedJobController
{
    public function index(Request $request, ManageFailedJobs $jobs): JsonResponse
    {
        return ApiResponse::paginated($jobs->paginate(ListQuery::perPage($request)), fn (object $row) => new FailedJobResource($row));
    }

    public function retry(string $uuid, ManageFailedJobs $jobs): JsonResponse
    {
        $jobs->retry($uuid);

        return ApiResponse::success(['uuid' => $uuid, 'retried' => true]);
    }

    public function retryAll(ManageFailedJobs $jobs): JsonResponse
    {
        return ApiResponse::success(['retried' => $jobs->retryAll()]);
    }

    public function destroy(string $uuid, ManageFailedJobs $jobs): JsonResponse
    {
        $jobs->delete($uuid);

        return ApiResponse::success(['uuid' => $uuid, 'deleted' => true]);
    }
}
