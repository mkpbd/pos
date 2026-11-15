<?php

namespace App\Modules\Storefront\Application\Builder\Publishing;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderReview;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Storefront\Infrastructure\Notifications\BuilderPublishingNotifier;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * B11: approval. Who may publish is decided by permissions only: anyone with storefront.manage can
 * submit a page's draft for review (the editor offers it to those without storefront.publish);
 * people with storefront.publish approve (publish now, or later = a schedule of the snapshot) or
 * send it back with a comment. There is no organization setting that forces reviews.
 *
 * Submitting snapshots the draft (content + revision); one pending review per document — a new
 * submission withdraws the previous one. Approving publishes the SNAPSHOT (also when the draft
 * changed since — the review shows `draft_changed`), its references checked again (gone records:
 * 422 DOCUMENT_INVALID, nothing changes). A review that is no longer pending is 409
 * REVIEW_NOT_PENDING (`details.status`). The submitter or a publisher may withdraw a pending review
 * (others: 403 REVIEW_NOT_YOURS).
 *
 * Bell notifications: publishers on submit; the submitter on approve / send back. Audit:
 * storefront.builder_review_submitted | _approved | _sent_back | _withdrawn (the publish itself:
 * storefront.builder_published with `via: review`).
 */
class BuilderReviews
{
    public const NOTE_MAX = 500;

    public const COMMENT_MAX = 1000;

    public function __construct(
        private readonly ManageBuilderDocuments $documents,
        private readonly BuilderPublishSchedules $schedules,
        private readonly AuditTrail $audit,
        private readonly BuilderPublishingNotifier $notifier,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    public function submit(BuilderDocument $document, ?string $note): BuilderReview
    {
        $note = $note === null || trim($note) === '' ? null : trim($note);

        return DB::transaction(function () use ($document, $note) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            if (($locked->draft['sections'] ?? []) === []) {
                throw new BusinessRuleViolation('DOCUMENT_EMPTY', 'Add at least one section before sending this page for review.');
            }
            $previous = BuilderReview::query()->where('document_id', $locked->id)->where('status', BuilderReview::PENDING)->lockForUpdate()->first();
            if ($previous !== null) {
                $this->decide($previous, BuilderReview::WITHDRAWN, null);
                $this->audit->record('storefront.builder_review_withdrawn', $locked, ['status' => BuilderReview::PENDING], ['status' => BuilderReview::WITHDRAWN], [
                    'review_id' => $previous->id,
                    'reason' => 'replaced',
                ]);
            }

            $review = BuilderReview::query()->create([
                'document_id' => $locked->id,
                'status' => BuilderReview::PENDING,
                'note' => $note,
                'schema_version' => $locked->schema_version,
                'content' => $locked->draft,
                'draft_revision' => $locked->draft_revision,
                'submitted_by' => StaffActor::id(),
            ]);
            $this->audit->record('storefront.builder_review_submitted', $locked, [], ['review_id' => $review->id, 'status' => BuilderReview::PENDING], array_filter([
                'note' => $note,
                'replaced' => $previous?->id,
            ]));
            $name = $review->submitted_by === null ? null
                : ($this->users->names($this->tenant->requireOrganization(), [$review->submitted_by])[$review->submitted_by] ?? null);
            $this->notifier->reviewSubmitted($review, $locked, $name);

            return $review;
        });
    }

    /**
     * Publishes the snapshot now (`$publishAt` null) or schedules it.
     */
    public function approve(BuilderReview $review, ?CarbonImmutable $publishAt, ?string $note, bool $cancelSchedule = false): BuilderReview
    {
        $note = $note === null || trim($note) === '' ? null : trim($note);

        return DB::transaction(function () use ($review, $publishAt, $note, $cancelSchedule) {
            $locked = $this->lockPending($review);
            $document = BuilderDocument::query()->whereKey($locked->document_id)->lockForUpdate()->firstOrFail();
            $versionNote = $note ?? ($locked->note === null ? null : mb_substr($locked->note, 0, 160));
            $schedule = null;
            if ($publishAt === null) {
                $document = $this->documents->publishSnapshot($document, $locked->content, $versionNote, BuilderVersion::VIA_REVIEW, ['review_id' => $locked->id]);
                $locked->version_id = $document->published_version_id;
                if ($cancelSchedule) {
                    $this->schedules->cancelIfPending($document, 'published_now');
                }
            } else {
                $schedule = $this->schedules->createFor($document, $locked->content, $locked->draft_revision, $publishAt, $versionNote, $locked->id);
            }
            $this->decide($locked, BuilderReview::APPROVED, null);
            $this->audit->record('storefront.builder_review_approved', $document, ['status' => BuilderReview::PENDING], ['status' => BuilderReview::APPROVED], array_filter([
                'review_id' => $locked->id,
                'version_id' => $locked->version_id,
                'schedule_id' => $schedule?->id,
                'publish_at' => $schedule?->publish_at->toIso8601String(),
            ]));
            $this->notifier->reviewDecided($locked, $document, $schedule);

            return $locked;
        });
    }

    public function sendBack(BuilderReview $review, string $comment): BuilderReview
    {
        $comment = trim($comment);

        return DB::transaction(function () use ($review, $comment) {
            $locked = $this->lockPending($review);
            $document = BuilderDocument::query()->whereKey($locked->document_id)->firstOrFail();
            $this->decide($locked, BuilderReview::SENT_BACK, $comment);
            $this->audit->record('storefront.builder_review_sent_back', $document, ['status' => BuilderReview::PENDING], ['status' => BuilderReview::SENT_BACK], [
                'review_id' => $locked->id,
                'comment' => $comment,
            ]);
            $this->notifier->reviewDecided($locked, $document);

            return $locked;
        });
    }

    public function withdraw(BuilderReview $review, bool $mayPublish): BuilderReview
    {
        return DB::transaction(function () use ($review, $mayPublish) {
            $locked = $this->lockPending($review);
            if (! $mayPublish && $locked->submitted_by !== StaffActor::id()) {
                throw new BusinessRuleViolation('REVIEW_NOT_YOURS', 'Only the person who sent this page for review, or someone who may publish, can withdraw it.', [], 403);
            }
            $document = BuilderDocument::query()->whereKey($locked->document_id)->firstOrFail();
            $this->decide($locked, BuilderReview::WITHDRAWN, null);
            $this->audit->record('storefront.builder_review_withdrawn', $document, ['status' => BuilderReview::PENDING], ['status' => BuilderReview::WITHDRAWN], [
                'review_id' => $locked->id,
                'reason' => 'withdrawn',
            ]);

            return $locked;
        });
    }

    private function lockPending(BuilderReview $review): BuilderReview
    {
        $locked = BuilderReview::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();
        if ($locked->status !== BuilderReview::PENDING) {
            throw new BusinessRuleViolation('REVIEW_NOT_PENDING', match ($locked->status) {
                BuilderReview::APPROVED => 'This review was already approved.',
                BuilderReview::SENT_BACK => 'This review was already sent back.',
                default => 'This review was withdrawn.',
            }, ['status' => $locked->status], 409);
        }

        return $locked;
    }

    private function decide(BuilderReview $review, string $status, ?string $comment): void
    {
        $review->status = $status;
        $review->decided_by = StaffActor::id();
        $review->decided_at = CarbonImmutable::now();
        $review->comment = $comment;
        $review->save();
    }
}
