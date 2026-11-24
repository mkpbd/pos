<?php

namespace App\Modules\System\Presentation\Http\Resources;

use App\Modules\System\Infrastructure\Models\ErrorEvent;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * G1b: an entry of the error log; `trace` only on the detail.
 *
 * @mixin ErrorEvent
 */
class ErrorEventResource extends JsonResource
{
    private bool $withTrace = false;

    public function withTrace(bool $include = true): static
    {
        $this->withTrace = $include;

        return $this;
    }

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fingerprint' => $this->fingerprint,
            'exception_class' => $this->exception_class,
            'message' => $this->message,
            'file' => $this->file,
            'line' => $this->line,
            'occurrences' => $this->occurrences,
            'first_seen_at' => $this->first_seen_at?->toIso8601String(),
            'last_seen_at' => $this->last_seen_at?->toIso8601String(),
            'last_method' => $this->last_method,
            'last_path' => $this->last_path,
            'last_request_id' => $this->last_request_id,
            'last_user_id' => $this->last_user_id,
            'last_organization_id' => $this->last_organization_id,
            'status' => $this->status,
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'resolved_by' => $this->resolved_by,
            'notified_at' => $this->notified_at?->toIso8601String(),
            'trace' => $this->when($this->withTrace, fn () => $this->trace),
        ];
    }
}
