<?php

namespace App\Modules\System\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\System\Application\Actions\QueueBackup;
use App\Modules\System\Application\Actions\QueueBackupVerification;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use App\Modules\System\Presentation\Http\Resources\BackupResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * G1b: database backups — history, "Back up now", "Verify". Files are never downloadable here.
 */
class BackupController
{
    public function index(Request $request): JsonResponse
    {
        return ApiResponse::paginated(
            ListQuery::paginate(SystemBackup::query(), $request, sortable: ['started_at'], defaultSort: '-started_at'),
            BackupResource::class,
        );
    }

    public function store(Request $request, QueueBackup $queue): JsonResponse
    {
        return ApiResponse::success(new BackupResource($queue((string) $request->user()->getAuthIdentifier())), 202);
    }

    public function verify(SystemBackup $backup, QueueBackupVerification $queue): JsonResponse
    {
        return ApiResponse::success(new BackupResource($queue($backup)), 202);
    }
}
