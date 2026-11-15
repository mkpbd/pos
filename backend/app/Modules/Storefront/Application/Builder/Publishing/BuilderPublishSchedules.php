<?php

namespace App\Modules\Storefront\Application\Builder\Publishing;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\ManageThemeDraft;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderReview;
use App\Modules\Storefront\Infrastructure\Models\BuilderSchedule;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Storefront\Infrastructure\Notifications\BuilderPublishingNotifier;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/**
 * B11: "publish later" for builder documents and the theme draft.
 *
 * Scheduling snapshots the CURRENT draft (content + revision) into a pending schedule — what goes
 * live is that snapshot, even when the draft changes afterwards. One pending schedule per document:
 * a new one cancels (replaces) the previous one. Cancelling by hand needs a pending schedule (409
 * NOTHING_SCHEDULED). A manual publish in between leaves the schedule pending.
 *
 * The scheduler (storefront:publish-scheduled, every minute) runs due schedules once each: claimed
 * under a row lock (SKIP LOCKED), the document locked while its snapshot is published as a normal
 * version (`via` scheduled, the schedule's note), audited as the user who scheduled it. Records the
 * snapshot refers to that were deleted since (or an emptied page) fail the schedule with the reason
 * (`failure {code, message, errors?}`), audited, and a bell notification goes to the scheduler —
 * nothing is published then. Unexpected errors leave it pending for the next run.
 *
 * Audit: storefront.builder_publish_scheduled, storefront.builder_schedule_cancelled,
 * storefront.builder_schedule_failed (the publish itself: storefront.builder_published /
 * storefront.theme_published with `via: scheduled` and `schedule_id`).
 */
class BuilderPublishSchedules
{
    public function __construct(
        private readonly ManageBuilderDocuments $documents,
        private readonly ManageThemeDraft $theme,
        private readonly AuditTrail $audit,
        private readonly BuilderPublishingNotifier $notifier,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    public function schedule(BuilderDocument $document, CarbonImmutable $publishAt, ?string $note): BuilderSchedule
    {
        return DB::transaction(function () use ($document, $publishAt, $note) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            if (($locked->draft['sections'] ?? []) === []) {
                throw new BusinessRuleViolation('DOCUMENT_EMPTY', 'Add at least one section before publishing this page.');
            }

            return $this->createFor($locked, $locked->draft, $locked->draft_revision, $publishAt, $note, null);
        });
    }

    public function scheduleTheme(CarbonImmutable $publishAt, ?string $note): BuilderSchedule
    {
        return DB::transaction(function () use ($publishAt, $note) {
            ['document' => $document, 'settings' => $settings] = $this->theme->lockedDraft();

            return $this->createFor($document, $settings, $document->draft_revision, $publishAt, $note, null);
        });
    }

    /**
     * A pending schedule of `$content` for a document the caller has locked; the document's
     * previous pending schedule is cancelled (replaced).
     *
     * @param  array<string, mixed>  $content
     */
    public function createFor(BuilderDocument $locked, array $content, int $revision, CarbonImmutable $publishAt, ?string $note, ?string $reviewId): BuilderSchedule
    {
        $note = $note === null || trim($note) === '' ? null : trim($note);
        $previous = BuilderSchedule::query()->where('document_id', $locked->id)->where('status', BuilderSchedule::PENDING)->lockForUpdate()->first();
        if ($previous !== null) {
            $this->markCancelled($previous, $locked, 'replaced');
        }

        $schedule = BuilderSchedule::query()->create([
            'document_id' => $locked->id,
            'status' => BuilderSchedule::PENDING,
            'publish_at' => $publishAt,
            'note' => $note,
            'schema_version' => $locked->schema_version,
            'content' => $content,
            'draft_revision' => $revision,
            'review_id' => $reviewId,
            'created_by' => StaffActor::id(),
        ]);
        $this->audit->record('storefront.builder_publish_scheduled', $locked, [], [
            'schedule_id' => $schedule->id,
            'publish_at' => $schedule->publish_at->toIso8601String(),
        ], array_filter(['note' => $note, 'review_id' => $reviewId, 'replaced' => $previous?->id]));

        return $schedule;
    }

    public function cancel(BuilderDocument $document): BuilderSchedule
    {
        return DB::transaction(function () use ($document) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();

            return $this->cancelPending($locked);
        });
    }

    public function cancelTheme(): BuilderSchedule
    {
        return DB::transaction(function () {
            $document = $this->theme->find();
            if ($document === null) {
                throw self::nothingScheduled();
            }

            return $this->cancelPending(BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail());
        });
    }

    /**
     * Publish now (the draft), optionally cancelling the pending schedule in the same transaction
     * so an older snapshot cannot come back over this publish (reason `published_now`).
     */
    public function publishNow(BuilderDocument $document, ?string $note, bool $cancelSchedule): BuilderDocument
    {
        return DB::transaction(function () use ($document, $note, $cancelSchedule) {
            $published = $this->documents->publish($document, $note);
            if ($cancelSchedule) {
                $this->cancelIfPending($published, 'published_now');
            }

            return $published;
        });
    }

    /**
     * The theme draft: like publishNow().
     */
    public function publishThemeNow(?string $note, bool $cancelSchedule): BuilderDocument
    {
        return DB::transaction(function () use ($note, $cancelSchedule) {
            $published = $this->theme->publish($note);
            if ($cancelSchedule) {
                $this->cancelIfPending($published, 'published_now');
            }

            return $published;
        });
    }

    /**
     * Cancels the document's pending schedule when there is one (audited with `$reason`).
     */
    public function cancelIfPending(BuilderDocument $document, string $reason): ?BuilderSchedule
    {
        $schedule = BuilderSchedule::query()->where('document_id', $document->id)->where('status', BuilderSchedule::PENDING)->lockForUpdate()->first();

        return $schedule === null ? null : $this->markCancelled($schedule, $document, $reason);
    }

    private function cancelPending(BuilderDocument $locked): BuilderSchedule
    {
        $schedule = BuilderSchedule::query()->where('document_id', $locked->id)->where('status', BuilderSchedule::PENDING)->lockForUpdate()->first();
        if ($schedule === null) {
            throw self::nothingScheduled();
        }

        return $this->markCancelled($schedule, $locked, 'cancelled');
    }

    private function markCancelled(BuilderSchedule $schedule, BuilderDocument $document, string $reason): BuilderSchedule
    {
        $schedule->status = BuilderSchedule::CANCELLED;
        $schedule->cancelled_by = StaffActor::id();
        $schedule->finished_at = CarbonImmutable::now();
        $schedule->save();
        $this->audit->record('storefront.builder_schedule_cancelled', $document, ['status' => BuilderSchedule::PENDING], ['status' => BuilderSchedule::CANCELLED], [
            'schedule_id' => $schedule->id,
            'publish_at' => $schedule->publish_at->toIso8601String(),
            'reason' => $reason,
        ]);

        return $schedule;
    }

    private static function nothingScheduled(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('NOTHING_SCHEDULED', 'Nothing is scheduled to be published.', [], 409);
    }

    /**
     * The scheduler: publishes one due schedule (in the current organization). False when it is
     * not (or no longer) pending and due, or another run holds it.
     */
    public function runDue(string $scheduleId): bool
    {
        return DB::transaction(function () use ($scheduleId) {
            $query = BuilderSchedule::query()->whereKey($scheduleId)
                ->where('status', BuilderSchedule::PENDING)
                ->where('publish_at', '<=', CarbonImmutable::now());
            /** @var BuilderSchedule|null $schedule */
            $schedule = (DB::getDriverName() === 'pgsql' ? $query->lock('for update skip locked') : $query->lockForUpdate())->first();
            if ($schedule === null) {
                return false;
            }
            /** @var BuilderDocument $document */
            $document = BuilderDocument::query()->whereKey($schedule->document_id)->firstOrFail();
            $theme = $document->kind === BuilderDocument::KIND_THEME;
            $context = array_filter(['schedule_id' => $schedule->id, 'review_id' => $schedule->review_id]);

            $this->asUser($schedule->created_by, function () use ($schedule, $document, $theme, $context) {
                try {
                    // A savepoint: a failed check leaves nothing half published.
                    $published = DB::transaction(fn () => $theme
                        ? $this->theme->publishSnapshot($schedule->content, $schedule->note, BuilderVersion::VIA_SCHEDULED, $context)
                        : $this->documents->publishSnapshot($document, $schedule->content, $schedule->note, BuilderVersion::VIA_SCHEDULED, $context));
                } catch (BusinessRuleViolation $e) {
                    $schedule->status = BuilderSchedule::FAILED;
                    $schedule->failure = array_filter([
                        'code' => $e->errorCode,
                        'message' => $e instanceof InvalidBuilderDocument ? 'Some things on this page were deleted since it was scheduled (pictures, products, banners or other records). Open the page, fix them and schedule it again.' : $e->getMessage(),
                        'errors' => $e instanceof InvalidBuilderDocument ? $e->errors : null,
                    ], fn ($v) => $v !== null);
                    $schedule->finished_at = CarbonImmutable::now();
                    $schedule->save();
                    $this->audit->record('storefront.builder_schedule_failed', $document, ['status' => BuilderSchedule::PENDING], ['status' => BuilderSchedule::FAILED], [
                        'schedule_id' => $schedule->id,
                        'code' => $e->errorCode,
                    ]);
                    $this->notifier->scheduleFailed($schedule, $document);

                    return;
                }

                $schedule->status = BuilderSchedule::DONE;
                $schedule->version_id = $published->published_version_id;
                $schedule->finished_at = CarbonImmutable::now();
                $schedule->save();
                if ($schedule->review_id !== null) {
                    BuilderReview::query()->whereKey($schedule->review_id)->update(['version_id' => $published->published_version_id]);
                }
            });

            return true;
        });
    }

    /**
     * Runs `$callback` as the given staff user (audit actor, version author) when still active
     * in the organization; as nobody otherwise.
     *
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    private function asUser(?string $userId, callable $callback): mixed
    {
        $user = $userId === null ? null : $this->users->active($this->tenant->requireOrganization(), [$userId])->first();
        if ($user === null) {
            return $callback();
        }
        $guard = Auth::guard();
        $previous = $guard->hasUser() ? $guard->user() : null;
        $guard->setUser($user);
        try {
            return $callback();
        } finally {
            if ($previous !== null) {
                $guard->setUser($previous);
            } elseif (method_exists($guard, 'forgetUser')) {
                $guard->forgetUser();
            }
        }
    }
}
