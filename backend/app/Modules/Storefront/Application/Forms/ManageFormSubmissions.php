<?php

namespace App\Modules\Storefront\Application\Forms;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * B8b: staff handling of form submissions (forms.manage): mark new / read / archived (read
 * records who and when; back to new clears it) and delete. Both audited; an unchanged status is
 * a no-op.
 */
class ManageFormSubmissions
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function setStatus(BuilderFormSubmission $submission, string $status): BuilderFormSubmission
    {
        if ($submission->status === $status) {
            return $submission;
        }

        return DB::transaction(function () use ($submission, $status) {
            $before = $submission->status;
            $submission->status = $status;
            if ($status === BuilderFormSubmission::STATUS_NEW) {
                $submission->read_at = null;
                $submission->read_by = null;
            } elseif ($submission->read_at === null) {
                $submission->read_at = CarbonImmutable::now();
                $submission->read_by = StaffActor::id();
            }
            $submission->save();
            $this->audit->record('form_submission.status_changed', $submission, ['status' => $before], ['status' => $status]);

            return $submission;
        });
    }

    public function delete(BuilderFormSubmission $submission): void
    {
        DB::transaction(function () use ($submission) {
            $submission->delete();
            $this->audit->record('form_submission.deleted', $submission, [
                'form_title' => $submission->form_title,
                'document_id' => $submission->document_id,
                'element_id' => $submission->element_id,
                'created_at' => $submission->created_at?->toIso8601String(),
            ]);
        });
    }
}
