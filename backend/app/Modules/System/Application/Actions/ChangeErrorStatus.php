<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\System\Infrastructure\Models\ErrorEvent;

/**
 * G1b: an operator resolves, ignores or reopens an error. A resolved error that happens again
 * reopens by itself (ErrorRecorder); an ignored one stays ignored and never alerts.
 */
final class ChangeErrorStatus
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(ErrorEvent $event, string $status, ?string $userId): ErrorEvent
    {
        $old = $event->status;
        if ($old === $status) {
            return $event;
        }

        $event->update([
            'status' => $status,
            'resolved_at' => $status === ErrorEvent::OPEN ? null : now(),
            'resolved_by' => $status === ErrorEvent::OPEN ? null : $userId,
        ]);

        $this->audit->record('system.error_status_changed', $event, ['status' => $old], ['status' => $status], [
            'exception_class' => $event->exception_class,
        ]);

        return $event;
    }
}
