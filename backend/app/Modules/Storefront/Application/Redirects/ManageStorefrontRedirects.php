<?php

namespace App\Modules\Storefront\Application\Redirects;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Storefront\Domain\RedirectPaths;
use App\Modules\Storefront\Infrastructure\Models\StorefrontRedirect;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * B16: redirects the merchant adds, edits and deletes (audited). The old address is normalized
 * and must be free (one redirect per address), not a reserved store page and not a live page
 * (a live page always wins, so the redirect would never apply). The target is a store path or
 * an http(s) URL; a store path that is itself redirected is followed to the end (chains are
 * stored collapsed), and a target that leads back to the old address is refused (a loop).
 * Redirects that went to the old address now go to the new target. Editing an automatic
 * redirect makes it the merchant's (source manual).
 */
class ManageStorefrontRedirects
{
    private const MAX_HOPS = 20;

    public function __construct(
        private readonly StorefrontRedirects $redirects,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{from_path?: string, to_path?: string, type?: int}  $data  validated (all on create)
     */
    public function save(StorefrontRedirect $redirect, array $data): StorefrontRedirect
    {
        $creating = ! $redirect->exists;
        $from = array_key_exists('from_path', $data) ? RedirectPaths::from((string) $data['from_path']) : $redirect->from_path;
        if ($from === null) {
            throw ValidationException::withMessages(['from_path' => ['Enter an address of your store, such as /old-page.']]);
        }
        if (RedirectPaths::reserved($from)) {
            throw ValidationException::withMessages(['from_path' => ['This address is always a page of your store, so it cannot be redirected.']]);
        }
        if ($this->redirects->live($from)) {
            throw ValidationException::withMessages(['from_path' => ['This address is a live page of your store. Change or remove that page first.']]);
        }
        $to = array_key_exists('to_path', $data) ? RedirectPaths::target((string) $data['to_path'], $this->redirects->ownHosts(), true) : $redirect->to_path;
        if ($to === null) {
            throw ValidationException::withMessages(['to_path' => ['Enter an address of your store, such as /new-page, or a web address starting with https://.']]);
        }

        return DB::transaction(function () use ($redirect, $creating, $from, $to, $data) {
            $taken = StorefrontRedirect::query()->where('from_path', $from)
                ->when(! $creating, fn ($q) => $q->whereKeyNot($redirect->id))->lockForUpdate()->exists();
            if ($taken) {
                throw ValidationException::withMessages(['from_path' => ['There already is a redirect from this address.']]);
            }
            $final = $this->follow($from, $to, $creating ? null : $redirect->id);
            $before = $creating ? [] : $this->snapshot($redirect);

            $redirect->fill([
                'from_path' => $from,
                'to_path' => $final,
                'type' => (int) ($data['type'] ?? $redirect->type ?? 301),
                'source' => StorefrontRedirect::SOURCE_MANUAL,
            ]);
            if ($creating) {
                $redirect->created_by = StaffActor::id();
            }
            $redirect->save();

            // Redirects that went to the old address go straight to the end now.
            StorefrontRedirect::query()->whereKeyNot($redirect->id)->where('to_path', $from)->get()
                ->each(fn (StorefrontRedirect $other) => $other->fill(['to_path' => $final])->save());

            $after = $this->snapshot($redirect);
            if ($creating) {
                $this->audit->record('storefront.redirect_created', $redirect, [], $after);
            } elseif ($before !== $after) {
                $this->audit->record('storefront.redirect_updated', $redirect, array_diff_assoc($before, $after), array_diff_assoc($after, $before));
            }

            return $redirect;
        });
    }

    public function delete(StorefrontRedirect $redirect): void
    {
        DB::transaction(function () use ($redirect) {
            $snapshot = $this->snapshot($redirect);
            $redirect->delete();
            $this->audit->record('storefront.redirect_deleted', $redirect, $snapshot);
        });
    }

    /**
     * The end of the chain starting at `$to` (a store path redirected again is followed); a
     * chain that comes back to `$from` is a loop (422 on to_path).
     */
    private function follow(string $from, string $to, ?string $selfId): string
    {
        $loop = fn () => ValidationException::withMessages(['to_path' => ['This would send visitors in a circle back to the old address.']]);
        $final = $to;
        for ($hop = 0; $hop <= self::MAX_HOPS; $hop++) {
            $path = RedirectPaths::targetPath($final);
            if ($path === null) {
                return $final;
            }
            if ($path === $from) {
                throw $loop();
            }
            $next = StorefrontRedirect::query()->where('from_path', $path)
                ->when($selfId !== null, fn ($q) => $q->whereKeyNot($selfId))->value('to_path');
            if (! is_string($next)) {
                return $final;
            }
            $final = $next;
        }

        throw $loop();
    }

    /**
     * @return array{from_path: string, to_path: string, type: int, source: string}
     */
    private function snapshot(StorefrontRedirect $redirect): array
    {
        return ['from_path' => $redirect->from_path, 'to_path' => $redirect->to_path, 'type' => (int) $redirect->type, 'source' => $redirect->source];
    }
}
