<?php

namespace App\Modules\System\Presentation\Http\Resources;

use App\Modules\System\Application\Actions\ManageFailedJobs;
use App\Modules\System\Domain\ErrorLog\ErrorText;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * G1b: a failed queue job — its name, queue and the first line of the exception (sanitised),
 * never the payload.
 */
class FailedJobResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $row = $this->resource;

        return [
            'id' => (int) $row->id,
            'uuid' => $row->uuid,
            'job' => ManageFailedJobs::displayName($row->payload),
            'queue' => $row->queue,
            'connection' => $row->connection,
            // A timestamp without time zone, written in UTC.
            'failed_at' => $row->failed_at !== null ? Carbon::parse($row->failed_at, 'UTC')->toIso8601String() : null,
            'exception' => ErrorText::sanitise(ErrorText::firstLine((string) $row->exception, 2000), 500),
        ];
    }
}
