<?php

namespace App\Modules\Storefront\Application\Builder\Collaboration;

use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\LockProvider;
use Illuminate\Contracts\Cache\Repository;

/**
 * B16: one editor at a time per builder document — a lease in the cache (no table), taken by the
 * first person with storefront.manage whose open editor says it is editing, renewed by that
 * editor's heartbeats and gone after LEASE_SECONDS of silence, on leave or on a take-over.
 *
 * While someone else holds a live lease, every action that writes the draft (or publishes it)
 * is 423 DOCUMENT_LOCKED with `details.user {id, name}`: assertCanWrite(). Without a staff
 * actor (the scheduler, console commands) nothing is checked.
 */
class BuilderEditLock
{
    public const LEASE_SECONDS = 90;

    public function __construct(private readonly Repository $cache) {}

    /**
     * 423 DOCUMENT_LOCKED when another staff member holds a live lease on the document.
     */
    public function assertCanWrite(BuilderDocument $document): void
    {
        $actor = StaffActor::id();
        if ($actor === null) {
            return;
        }
        $lock = $this->current($document);
        if ($lock !== null && $lock['user_id'] !== $actor) {
            throw self::locked($document, $lock);
        }
    }

    /**
     * @param  array{user_id: string, name: string, acquired_at: string, expires_at: string}  $lock
     */
    public static function locked(BuilderDocument $document, array $lock): BusinessRuleViolation
    {
        return new BusinessRuleViolation('DOCUMENT_LOCKED', "{$lock['name']} is editing this page. Ask to edit or take over.", [
            'user' => ['id' => $lock['user_id'], 'name' => $lock['name']],
            'document_id' => $document->id,
            'expires_at' => $lock['expires_at'],
        ], 423);
    }

    /**
     * The live lease, or null (none, or expired).
     *
     * @return array{user_id: string, name: string, acquired_at: string, expires_at: string}|null
     */
    public function current(BuilderDocument $document): ?array
    {
        $lock = $this->cache->get($this->key($document));
        if (! is_array($lock) || ! isset($lock['user_id'], $lock['expires_at'])) {
            return null;
        }

        return CarbonImmutable::parse($lock['expires_at'])->isPast() ? null : $lock;
    }

    /**
     * Gives the lease to `$userId` (a fresh one when someone else held it), valid for LEASE_SECONDS.
     *
     * @return array{user_id: string, name: string, acquired_at: string, expires_at: string}
     */
    public function hold(BuilderDocument $document, string $userId, string $name): array
    {
        $now = CarbonImmutable::now();
        $current = $this->current($document);
        $lock = [
            'user_id' => $userId,
            'name' => $name,
            'acquired_at' => $current !== null && $current['user_id'] === $userId ? $current['acquired_at'] : $now->toIso8601String(),
            'expires_at' => $now->addSeconds(self::LEASE_SECONDS)->toIso8601String(),
        ];
        $this->cache->put($this->key($document), $lock, self::LEASE_SECONDS + 30);

        return $lock;
    }

    /**
     * Ends `$userId`'s lease (nothing when someone else holds it).
     */
    public function release(BuilderDocument $document, string $userId): void
    {
        $current = $this->current($document);
        if ($current !== null && $current['user_id'] === $userId) {
            $this->cache->forget($this->key($document));
        }
    }

    /**
     * Runs `$callback` while no other request changes this document's presence or lease.
     *
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    public function exclusively(BuilderDocument $document, callable $callback): mixed
    {
        $store = $this->cache->getStore();
        if (! $store instanceof LockProvider) {
            return $callback();
        }

        return $store->lock('builder-presence-mutex:'.$document->id, 5)->block(5, $callback);
    }

    private function key(BuilderDocument $document): string
    {
        return 'builder-edit-lock:'.$document->organization_id.':'.$document->id;
    }
}
