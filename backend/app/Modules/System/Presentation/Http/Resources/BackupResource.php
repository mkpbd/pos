<?php

namespace App\Modules\System\Presentation\Http\Resources;

use App\Modules\System\Infrastructure\Models\SystemBackup;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * G1b: a backup run. Only the file's base name — never its folder.
 *
 * @mixin SystemBackup
 */
class BackupResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'started_at' => $this->started_at?->toIso8601String(),
            'finished_at' => $this->finished_at?->toIso8601String(),
            'file_name' => $this->file_name,
            'size_bytes' => $this->size_bytes,
            'sha256' => $this->sha256,
            'error' => $this->error,
            'offsite_status' => $this->offsite_status,
            'offsite_error' => $this->offsite_error,
            'verified_at' => $this->verified_at?->toIso8601String(),
            'verify_status' => $this->verify_status,
            'verify_error' => $this->verify_error,
            'verify_mode' => $this->verify_mode,
            'triggered_by' => $this->triggered_by,
            'user_id' => $this->user_id,
            'file_deleted_at' => $this->file_deleted_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
