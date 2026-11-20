<?php

namespace App\Modules\Storefront\Application\Builder\Collaboration;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Infrastructure\Models\BuilderComment;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Notifications\BuilderCollaborationNotifier;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Cache\Repository;

/**
 * B16: who has a builder document open (heartbeats every ~20 s from the editor, kept in the
 * cache; an entry is gone after PRESENCE_SECONDS without one) and the edit lease
 * (BuilderEditLock): the first person with storefront.manage whose editor says `editing` gets
 * it; their heartbeats renew it; it ends on leave, on `editing: false` from them, after 90 s of
 * silence or on a take-over (storefront.publish while the lease is live; anyone who may edit once
 * it expired), which is audited and tells the previous editor with a bell notification. "Ask to
 * edit" sends the editor a bell (once a minute per person).
 */
class BuilderPresence
{
    public const PRESENCE_SECONDS = 60;

    /** "Ask to edit" notifies the editor at most once in this many seconds per person. */
    public const REQUEST_SECONDS = 60;

    public function __construct(
        private readonly Repository $cache,
        private readonly BuilderEditLock $lock,
        private readonly UserDirectory $users,
        private readonly AuditTrail $audit,
        private readonly BuilderCollaborationNotifier $notifier,
    ) {}

    /**
     * A heartbeat: I am here (and want to edit when `$editing` and `$mayEdit`).
     *
     * @return array<string, mixed> the presence state
     */
    public function heartbeat(BuilderDocument $document, bool $editing, bool $mayEdit): array
    {
        [$userId, $name] = $this->actor($document);

        $this->lock->exclusively($document, function () use ($document, $editing, $mayEdit, $userId, $name) {
            $this->touch($document, $userId, $name);
            $current = $this->lock->current($document);
            if ($editing && $mayEdit && ($current === null || $current['user_id'] === $userId)) {
                $this->lock->hold($document, $userId, $name);
            } elseif (! $editing) {
                $this->lock->release($document, $userId);
            }
        });

        return $this->state($document, $userId);
    }

    /**
     * I left (closed the editor): my entry goes and my lease ends.
     */
    public function leave(BuilderDocument $document): void
    {
        $userId = StaffActor::id();
        if ($userId === null) {
            return;
        }
        $this->lock->exclusively($document, function () use ($document, $userId) {
            $entries = $this->entries($document);
            unset($entries[$userId]);
            $this->putEntries($document, $entries);
            $this->lock->release($document, $userId);
        });
    }

    /**
     * Takes the lease. From someone else whose lease is live: needs `$mayPublish` (403
     * TAKE_OVER_FORBIDDEN otherwise); audited and the previous editor is notified.
     *
     * @return array<string, mixed> the presence state
     */
    public function takeOver(BuilderDocument $document, bool $mayPublish): array
    {
        [$userId, $name] = $this->actor($document);

        $previous = $this->lock->exclusively($document, function () use ($document, $mayPublish, $userId, $name) {
            $current = $this->lock->current($document);
            $previous = $current !== null && $current['user_id'] !== $userId ? $current : null;
            if ($previous !== null && ! $mayPublish) {
                throw new BusinessRuleViolation('TAKE_OVER_FORBIDDEN', "{$previous['name']} is editing this page. Only people who may publish can take over now; ask to edit instead.", [
                    'user' => ['id' => $previous['user_id'], 'name' => $previous['name']],
                ], 403);
            }
            $this->touch($document, $userId, $name);
            $this->lock->hold($document, $userId, $name);

            return $previous;
        });

        if ($previous !== null) {
            $this->audit->record('storefront.builder_lock_taken_over', $document, ['user_id' => $previous['user_id']], ['user_id' => $userId], [
                'previous_user_name' => $previous['name'],
            ]);
            $this->notifier->tookOver($document, $previous['user_id'], $name);
        }

        return $this->state($document, $userId);
    }

    /**
     * "Ask to edit": a bell for whoever holds the lease (409 NOT_LOCKED when nobody else does).
     * `sent` is false when this person already asked within the last minute.
     *
     * @return array{sent: bool}
     */
    public function requestEdit(BuilderDocument $document): array
    {
        [$userId, $name] = $this->actor($document);
        $current = $this->lock->current($document);
        if ($current === null || $current['user_id'] === $userId) {
            throw new BusinessRuleViolation('NOT_LOCKED', 'Nobody else is editing this page now. You can start editing.', [], 409);
        }
        $sent = $this->cache->add('builder-edit-request:'.$document->id.':'.$userId.':'.$current['user_id'], true, self::REQUEST_SECONDS);
        if ($sent) {
            $this->notifier->editRequested($document, $current['user_id'], $name);
        }

        return ['sent' => $sent];
    }

    /**
     * `{viewers, lock, mine, draft_revision, draft_updated_at, comments: {open, updated_at}}`.
     *
     * @return array<string, mixed>
     */
    public function state(BuilderDocument $document, ?string $userId): array
    {
        $lock = $this->lock->current($document);
        $viewers = array_values(array_map(fn (array $entry) => [
            'user' => ['id' => $entry['user_id'], 'name' => $entry['name']],
            'editing' => $lock !== null && $lock['user_id'] === $entry['user_id'],
            'since' => $entry['since'],
            'last_seen' => $entry['last_seen'],
            'is_me' => $entry['user_id'] === $userId,
        ], $this->entries($document)));
        usort($viewers, fn (array $a, array $b) => [$a['since'], $a['user']['id']] <=> [$b['since'], $b['user']['id']]);

        $comments = BuilderComment::query()->where('document_id', $document->id);
        $fresh = BuilderDocument::query()->whereKey($document->id)->first(['id', 'draft_revision', 'draft_updated_at']) ?? $document;

        return [
            'viewers' => $viewers,
            'lock' => $lock === null ? null : [
                'user' => ['id' => $lock['user_id'], 'name' => $lock['name']],
                'acquired_at' => $lock['acquired_at'],
                'expires_at' => $lock['expires_at'],
            ],
            'mine' => $lock !== null && $lock['user_id'] === $userId,
            'draft_revision' => $fresh->draft_revision,
            'draft_updated_at' => $fresh->draft_updated_at?->toIso8601String(),
            'comments' => [
                'open' => (clone $comments)->whereNull('parent_id')->whereNull('resolved_at')->count(),
                'updated_at' => $this->latest(BuilderComment::withTrashed()->where('document_id', $document->id)->max('updated_at')),
            ],
        ];
    }

    private function latest(mixed $value): ?string
    {
        return $value === null ? null : CarbonImmutable::parse($value)->toIso8601String();
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function actor(BuilderDocument $document): array
    {
        $userId = StaffActor::id();
        if ($userId === null) {
            throw new AuthorizationException('Only staff can open the store builder.');
        }

        return [$userId, $this->users->names($document->organization_id, [$userId])[$userId] ?? 'Someone'];
    }

    private function touch(BuilderDocument $document, string $userId, string $name): void
    {
        $now = CarbonImmutable::now()->toIso8601String();
        $entries = $this->entries($document);
        $entries[$userId] = [
            'user_id' => $userId,
            'name' => $name,
            'since' => $entries[$userId]['since'] ?? $now,
            'last_seen' => $now,
        ];
        $this->putEntries($document, $entries);
    }

    /**
     * The live entries (older than PRESENCE_SECONDS left out), keyed by user id.
     *
     * @return array<string, array{user_id: string, name: string, since: string, last_seen: string}>
     */
    private function entries(BuilderDocument $document): array
    {
        $entries = $this->cache->get($this->key($document));
        if (! is_array($entries)) {
            return [];
        }
        $cutoff = CarbonImmutable::now()->subSeconds(self::PRESENCE_SECONDS);

        return array_filter($entries, fn ($entry) => is_array($entry) && isset($entry['last_seen'])
            && CarbonImmutable::parse($entry['last_seen'])->greaterThan($cutoff));
    }

    /**
     * @param  array<string, array<string, string>>  $entries
     */
    private function putEntries(BuilderDocument $document, array $entries): void
    {
        if ($entries === []) {
            $this->cache->forget($this->key($document));

            return;
        }
        $this->cache->put($this->key($document), $entries, self::PRESENCE_SECONDS * 2);
    }

    private function key(BuilderDocument $document): string
    {
        return 'builder-presence:'.$document->organization_id.':'.$document->id;
    }
}
