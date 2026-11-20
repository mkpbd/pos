<?php

namespace App\Modules\Storefront\Application\Builder\Collaboration;

use App\Modules\Shared\Application\Contracts\AuditHistory;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderEditSession;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;

/**
 * B16: a builder document's activity log, newest first — its audit entries (created, renamed,
 * published, unpublished, scheduled / cancelled / failed, reviews, checkpoints, restores, A/B
 * tests, lock take-overs, comments resolved / reopened / deleted …) merged with the edit
 * sessions (BuilderEditSessions), each with a plain-words `summary` and the `details` the editor
 * links from (version ids and numbers). Paged with `before` (exclusive) → `next_before`.
 */
class BuilderActivity
{
    public const PAGE = 30;

    public const PAGE_MAX = 50;

    private const PREFIX = 'storefront.builder_';

    /** UTC with microseconds: `next_before` pages exactly (no "+" to encode in the query). */
    private const CURSOR = 'Y-m-d\TH:i:s.u\Z';

    private const TIME = 'Y-m-d\TH:i:s.v\Z';

    public function __construct(
        private readonly AuditHistory $history,
        private readonly UserDirectory $users,
    ) {}

    /**
     * @return array{items: list<array<string, mixed>>, next_before: ?string}
     */
    public function page(BuilderDocument $document, ?CarbonImmutable $before, int $limit = self::PAGE): array
    {
        $limit = max(1, min(self::PAGE_MAX, $limit));
        $entries = [];
        foreach ($this->history->forSubject('builder_documents', $document->id, $before, $limit + 1, self::PREFIX) as $entry) {
            $entries[] = $this->fromAudit($entry);
        }
        $sessions = BuilderEditSession::query()
            ->where('document_id', $document->id)
            ->when($before !== null, fn ($q) => $q->where('ended_at', '<', $before->format('Y-m-d H:i:s.uP')))
            ->orderByDesc('ended_at')->orderByDesc('id')
            ->limit($limit + 1)
            ->get();
        foreach ($sessions as $session) {
            $entries[] = $this->fromSession($session);
        }

        usort($entries, fn (array $a, array $b) => [$b['_at'], $b['id']] <=> [$a['_at'], $a['id']]);
        $more = count($entries) > $limit;
        if ($more) {
            // Times are stored to the second: a page never ends inside a group of entries with the
            // same time (the next page, `< next_before`, would skip the rest of the group) —
            // unless the whole page is one group.
            $cut = $entries[$limit]['_at'];
            $kept = array_values(array_filter(array_slice($entries, 0, $limit), fn (array $e) => $e['_at'] !== $cut));
            $entries = $kept !== [] ? $kept : array_slice($entries, 0, $limit);
        }

        $names = $this->users->names($document->organization_id, array_values(array_unique(array_filter(array_column($entries, '_user')))));
        $items = array_map(function (array $entry) use ($names) {
            $userId = $entry['_user'];
            unset($entry['_user'], $entry['_at']);

            return ['user' => $userId === null ? null : ['id' => $userId, 'name' => $names[$userId] ?? null]] + $entry;
        }, $entries);

        $last = end($entries);

        return [
            'items' => array_values(array_map(fn (array $item) => [
                'id' => $item['id'],
                'at' => $item['at'],
                'user' => $item['user'],
                'action' => $item['action'],
                'summary' => $item['summary'],
                'details' => (object) $item['details'],
            ], $items)),
            'next_before' => $more && $last !== false ? $last['_at'] : null,
        ];
    }

    /**
     * @param  array{id: string, action: string, user_id: ?string, old_values: ?array<string, mixed>, new_values: ?array<string, mixed>, context: ?array<string, mixed>, created_at: CarbonImmutable}  $entry
     * @return array<string, mixed>
     */
    private function fromAudit(array $entry): array
    {
        $action = substr($entry['action'], strlen(self::PREFIX));
        $old = $entry['old_values'] ?? [];
        $new = $entry['new_values'] ?? [];
        $context = $entry['context'] ?? [];
        [$summary, $details] = self::describe($action, $old, $new, $context);

        return [
            'id' => $entry['id'],
            '_at' => $entry['created_at']->utc()->format(self::CURSOR),
            '_user' => $entry['user_id'],
            'at' => $entry['created_at']->utc()->format(self::TIME),
            'action' => $action,
            'summary' => $summary,
            'details' => $details,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function fromSession(BuilderEditSession $session): array
    {
        $saves = $session->saves;

        return [
            'id' => $session->id,
            '_at' => $session->ended_at->utc()->format(self::CURSOR),
            '_user' => $session->user_id,
            'at' => $session->ended_at->utc()->format(self::TIME),
            'action' => 'edited',
            'summary' => 'Edited the draft ('.$saves.' '.($saves === 1 ? 'save' : 'saves').')',
            'details' => [
                'started_at' => $session->started_at->utc()->format(self::TIME),
                'ended_at' => $session->ended_at->utc()->format(self::TIME),
                'saves' => $saves,
                'first_revision' => $session->first_revision,
                'last_revision' => $session->last_revision,
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $old
     * @param  array<string, mixed>  $new
     * @param  array<string, mixed>  $context
     * @return array{0: string, 1: array<string, mixed>}
     */
    public static function describe(string $action, array $old, array $new, array $context): array
    {
        $quote = fn (mixed $text) => '“'.(string) $text.'”';
        $number = $new['number'] ?? $context['number'] ?? null;

        return match ($action) {
            'created' => ['Created the page'.self::from($new['from'] ?? null), array_filter(['from' => $new['from'] ?? null])],
            'renamed' => ['Renamed it from '.$quote($old['title'] ?? '').' to '.$quote($new['title'] ?? ''), ['from' => $old['title'] ?? null, 'to' => $new['title'] ?? null]],
            'published' => [
                'Published version '.$number.match ($context['via'] ?? null) {
                    'scheduled' => ' (at the scheduled time)',
                    'review' => ' (approved review)',
                    default => '',
                },
                array_filter([
                    'version_id' => $new['published_version_id'] ?? null,
                    'version_number' => $number,
                    'note' => $context['note'] ?? null,
                    'via' => $context['via'] ?? 'manual',
                ], fn ($v) => $v !== null),
            ],
            'unpublished' => ['Took the design off the store (the standard page shows again)', []],
            'discarded' => ['Discarded the draft changes (back to version '.$number.')', ['version_number' => $number]],
            'restored' => ($new['kind'] ?? null) === 'checkpoint'
                ? ['Restored the checkpoint '.$quote($new['name'] ?? 'without a name').' into the draft', ['version_id' => $new['version_id'] ?? null, 'kind' => 'checkpoint', 'name' => $new['name'] ?? null]]
                : ['Restored version '.$number.' into the draft', ['version_id' => $new['version_id'] ?? null, 'version_number' => $number, 'kind' => 'version']],
            'checkpoint_saved' => [($new['name'] ?? null) === null ? 'Saved a checkpoint of the draft' : 'Saved the checkpoint '.$quote($new['name']), ['version_id' => $new['version_id'] ?? null, 'name' => $new['name'] ?? null]],
            'checkpoint_deleted' => ['Deleted the checkpoint '.$quote($old['name'] ?? 'without a name'), ['name' => $old['name'] ?? null]],
            'version_renamed' => [($new['name'] ?? null) === null ? 'Removed a version’s name' : 'Named '.(($context['kind'] ?? null) === 'checkpoint' ? 'a checkpoint' : 'version '.($context['number'] ?? '')).' '.$quote($new['name']), ['version_id' => $context['version_id'] ?? null, 'version_number' => $context['number'] ?? null, 'name' => $new['name'] ?? null]],
            'publish_scheduled' => ['Scheduled publishing', array_filter(['publish_at' => $new['publish_at'] ?? null, 'note' => $context['note'] ?? null])],
            'schedule_cancelled' => [($context['reason'] ?? null) === 'published_now' ? 'Cancelled the scheduled publish (published now instead)' : 'Cancelled the scheduled publish', array_filter(['publish_at' => $context['publish_at'] ?? null, 'reason' => $context['reason'] ?? null])],
            'schedule_failed' => ['The scheduled publish failed; nothing changed on the store', array_filter(['code' => $context['code'] ?? null])],
            'review_submitted' => ['Sent the changes for review', array_filter(['review_id' => $new['review_id'] ?? null, 'note' => $context['note'] ?? null])],
            'review_approved' => [isset($context['publish_at']) ? 'Approved the changes (to publish at the scheduled time)' : 'Approved the changes', array_filter(['review_id' => $context['review_id'] ?? null, 'version_id' => $context['version_id'] ?? null, 'publish_at' => $context['publish_at'] ?? null])],
            'review_sent_back' => ['Sent the changes back', array_filter(['review_id' => $context['review_id'] ?? null, 'comment' => $context['comment'] ?? null])],
            'review_withdrawn' => [($context['reason'] ?? null) === 'replaced' ? 'A newer review replaced the earlier one' : 'Withdrew the review', array_filter(['review_id' => $context['review_id'] ?? null])],
            'experiment_started' => ['Started the A/B test'.self::named($new['name'] ?? null), array_filter(['experiment_id' => $new['experiment_id'] ?? null])],
            'experiment_stopped' => ['Stopped the A/B test'.self::named($new['name'] ?? $old['name'] ?? null), array_filter(['experiment_id' => $new['experiment_id'] ?? null])],
            'experiment_kept' => ['Kept one version of the A/B test'.self::named($old['name'] ?? null), array_filter(['experiment_id' => $new['experiment_id'] ?? null, 'arm' => $new['winner'] ?? $new['arm'] ?? null])],
            'popup_activated' => ['Switched the popup on', []],
            'popup_deactivated' => ['Switched the popup off', []],
            'section_copied' => ['Copied a section into the draft', array_filter(['section_id' => $new['section_id'] ?? null])],
            'banner_edited' => ['Changed a banner on the page', array_filter(['banner_id' => $new['banner_id'] ?? null])],
            'ai_written' => ['Wrote texts with AI', []],
            'lock_taken_over' => ['Took over editing'.(isset($context['previous_user_name']) ? ' from '.$context['previous_user_name'] : ''), array_filter(['previous_user_id' => $old['user_id'] ?? null])],
            'comment_resolved' => ['Resolved comment '.self::pin($new['number'] ?? null), ['comment_id' => $new['comment_id'] ?? null, 'number' => $new['number'] ?? null]],
            'comment_reopened' => ['Reopened comment '.self::pin($new['number'] ?? null), ['comment_id' => $new['comment_id'] ?? null, 'number' => $new['number'] ?? null]],
            'comment_deleted' => [($context['reply'] ?? false) ? 'Deleted a reply to a comment' : 'Deleted comment '.self::pin($old['number'] ?? null), ['comment_id' => $old['comment_id'] ?? null]],
            'deleted' => ['Deleted the page', []],
            default => ['Changed the page', []],
        };
    }

    private static function from(mixed $from): string
    {
        return match (true) {
            ! is_string($from) || $from === 'blank' => '',
            $from === 'homepage' => ' from the current homepage',
            $from === 'cms' => ' from the content page',
            $from === 'current' => ' from the current layout',
            $from === 'section' => ' from a section',
            $from === 'starter' => ' from the starter design',
            str_starts_with($from, 'template:') => ' from a template',
            str_starts_with($from, 'demo:') => ' from a demo store',
            default => '',
        };
    }

    private static function named(mixed $name): string
    {
        return is_string($name) && $name !== '' ? ' “'.$name.'”' : '';
    }

    private static function pin(mixed $number): string
    {
        return $number === null ? '' : '#'.$number;
    }
}
