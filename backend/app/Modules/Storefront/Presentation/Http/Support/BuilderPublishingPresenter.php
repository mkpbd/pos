<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderReview;
use App\Modules\Storefront\Infrastructure\Models\BuilderSchedule;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * B11: API shapes of schedules, reviews and versions / checkpoints, and the `schedule` and
 * `review` of document summaries.
 *
 * - schedule: `{id, status: pending|done|failed|cancelled, publish_at, note, created_by: {id,
 *   name}|null, failure: {code, message, errors?}|null, review_id, version: {id, number}|null,
 *   draft_changed, finished_at, created_at}`.
 * - review: `{id, document: {id, kind, key, title}, status: pending|approved|sent_back|withdrawn,
 *   note, submitted_by, submitted_at, decided_by, decided_at, comment, draft_changed, schedule:
 *   <schedule>|null, version: {id, number}|null}`.
 * - Summaries: `schedule` = the pending schedule, else the latest failed one when nothing was
 *   published after it failed, else null; `review` = the latest review when it is pending, or sent
 *   back after the last publish; else null.
 */
final class BuilderPublishingPresenter
{
    /**
     * @param  array<string, string>  $names  user names by id
     * @return array<string, mixed>
     */
    public static function schedule(BuilderSchedule $schedule, array $names, ?BuilderDocument $document = null): array
    {
        $document ??= $schedule->document;

        return [
            'id' => $schedule->id,
            'status' => $schedule->status,
            'publish_at' => $schedule->publish_at->toIso8601String(),
            'note' => $schedule->note,
            'created_by' => self::user($schedule->created_by, $names),
            'failure' => $schedule->failure,
            'review_id' => $schedule->review_id,
            'version' => $schedule->version_id === null ? null : ['id' => $schedule->version_id, 'number' => $schedule->version?->number],
            'draft_changed' => $document !== null && self::draftChanged($document, $schedule->content),
            'finished_at' => $schedule->finished_at?->toIso8601String(),
            'created_at' => $schedule->created_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    public static function review(BuilderReview $review, array $names): array
    {
        $document = $review->document;
        $schedule = $review->status === BuilderReview::APPROVED ? $review->schedule : null;

        return [
            'id' => $review->id,
            'document' => $document === null ? null : ['id' => $document->id, 'kind' => $document->kind, 'key' => $document->key, 'title' => $document->title],
            'status' => $review->status,
            'note' => $review->note,
            'submitted_by' => self::user($review->submitted_by, $names),
            'submitted_at' => $review->created_at?->toIso8601String(),
            'decided_by' => self::user($review->decided_by, $names),
            'decided_at' => $review->decided_at?->toIso8601String(),
            'comment' => $review->comment,
            'draft_changed' => $document !== null && self::draftChanged($document, $review->content),
            'schedule' => $schedule === null ? null : self::schedule($schedule, $names, $document),
            'version' => $review->version_id === null ? null : ['id' => $review->version_id, 'number' => $review->version?->number],
        ];
    }

    /**
     * @param  iterable<BuilderReview>  $reviews
     * @return list<array<string, mixed>>
     */
    public static function reviews(iterable $reviews): array
    {
        $reviews = collect($reviews);
        $names = self::names($reviews->flatMap(fn (BuilderReview $r) => [$r->submitted_by, $r->decided_by, $r->schedule?->created_by]));

        return $reviews->map(fn (BuilderReview $r) => self::review($r, $names))->values()->all();
    }

    /**
     * Versions and checkpoints, newest first: `[{id, kind: version|checkpoint, number|null, name,
     * note, via: manual|scheduled|review|null, published_at|null, created_by, created_at}]`.
     *
     * @param  iterable<BuilderVersion>  $versions
     * @return list<array<string, mixed>>
     */
    public static function versions(iterable $versions): array
    {
        $versions = collect($versions);
        $names = self::names($versions->pluck('created_by'));

        return $versions->map(fn (BuilderVersion $v) => self::version($v, $names))->values()->all();
    }

    /**
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    public static function version(BuilderVersion $version, array $names): array
    {
        return [
            'id' => $version->id,
            'kind' => $version->kind,
            'number' => $version->number,
            'name' => $version->name,
            'note' => $version->note,
            'via' => $version->via,
            'published_at' => $version->published_at?->toIso8601String(),
            'created_by' => self::user($version->created_by, $names),
            'created_at' => $version->created_at?->toIso8601String(),
        ];
    }

    /**
     * The `schedule` and `review` of each document's summary, by document id (two queries for all).
     *
     * @param  iterable<BuilderDocument>  $documents  with publishedVersion loaded
     * @return array<string, array{schedule: array<string, mixed>|null, review: array<string, mixed>|null}>
     */
    public static function states(iterable $documents): array
    {
        $documents = collect($documents)->keyBy('id');
        if ($documents->isEmpty()) {
            return [];
        }
        $ids = $documents->keys()->all();
        $schedules = BuilderSchedule::query()->with('version:id,number')->whereIn('document_id', $ids)
            ->whereIn('status', [BuilderSchedule::PENDING, BuilderSchedule::FAILED])
            ->orderByDesc('created_at')->orderByDesc('id')->get()->groupBy('document_id');
        $reviews = BuilderReview::query()->with(['version:id,number', 'schedule.version:id,number'])->whereIn('document_id', $ids)
            ->whereIn('status', [BuilderReview::PENDING, BuilderReview::SENT_BACK])
            ->orderByDesc('created_at')->orderByDesc('id')->get()->groupBy('document_id');
        // A sent-back review counts only while no newer review (approved, withdrawn) exists.
        $latestAt = BuilderReview::query()->whereIn('document_id', $ids)->groupBy('document_id')
            ->selectRaw('document_id, max(created_at) as latest_at')->pluck('latest_at', 'document_id');

        $chosen = [];
        foreach ($documents as $id => $document) {
            $liveAt = $document->publishedVersion?->published_at;
            /** @var Collection<int, BuilderSchedule> $own */
            $own = $schedules->get($id, collect());
            $schedule = $own->firstWhere('status', BuilderSchedule::PENDING)
                ?? $own->first(fn (BuilderSchedule $s) => $s->status === BuilderSchedule::FAILED && ($liveAt === null || $s->finished_at === null || $s->finished_at->gt($liveAt)));
            /** @var BuilderReview|null $latest */
            $latest = $reviews->get($id, collect())->first();
            $newest = isset($latestAt[$id]) ? CarbonImmutable::parse((string) $latestAt[$id]) : null;
            $review = match (true) {
                $latest === null => null,
                $latest->status === BuilderReview::PENDING => $latest,
                ($newest === null || $latest->created_at === null || $latest->created_at->gte($newest))
                    && ($liveAt === null || $latest->decided_at === null || $latest->decided_at->gt($liveAt)) => $latest,
                default => null,
            };
            $chosen[$id] = ['schedule' => $schedule, 'review' => $review];
        }

        $names = self::names(collect($chosen)->flatMap(fn (array $c) => [$c['schedule']?->created_by, $c['review']?->submitted_by, $c['review']?->decided_by]));
        $states = [];
        foreach ($chosen as $id => $c) {
            $document = $documents[$id];
            $c['review']?->setRelation('document', $document);
            $states[$id] = [
                'schedule' => $c['schedule'] === null ? null : self::schedule($c['schedule'], $names, $document),
                'review' => $c['review'] === null ? null : self::review($c['review'], $names),
            ];
        }

        return $states;
    }

    /**
     * Whether the document's draft differs from a snapshot (by value; the theme by its schema).
     *
     * @param  array<string, mixed>  $content
     */
    public static function draftChanged(BuilderDocument $document, array $content): bool
    {
        if ($document->kind === BuilderDocument::KIND_THEME) {
            return ! ThemeSchema::same(ThemeSchema::normalize($document->draft), ThemeSchema::normalize($content));
        }

        return self::canonical($document->draft) !== self::canonical($content);
    }

    /**
     * @param  iterable<?string>  $ids
     * @return array<string, string>
     */
    public static function names(iterable $ids): array
    {
        $ids = collect($ids)->filter()->unique()->values()->all();

        return $ids === [] ? [] : app(UserDirectory::class)->names(app(TenantContext::class)->requireOrganization(), $ids);
    }

    /**
     * @param  array<string, string>  $names
     * @return array{id: string, name: ?string}|null
     */
    private static function user(?string $id, array $names): ?array
    {
        return $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];
    }

    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $value = array_map(fn ($v) => self::canonical($v), $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }
}
