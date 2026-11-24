<?php

namespace App\Modules\Imports\Application\Data;

use App\Modules\Shared\Application\Contracts\TenantUser;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;

/**
 * Everything a handler knows about the import it works for: the organization and branch (also
 * in TenantContext while handlers run), the user who started it (permissions are checked as
 * that user), the options, whether this is the dry run, and a memo for lookups shared by rows
 * (stores, units, categories…). Handlers that create such records during the run must update
 * the memo (put()) so a later row finds them.
 */
final class ImportContext
{
    /** @var array<string, mixed> */
    private array $memo = [];

    /**
     * @param  array<string, mixed>  $options
     */
    public function __construct(
        public readonly string $importId,
        public readonly string $organizationId,
        public readonly ?string $branchId,
        public readonly TenantUser&Authenticatable $user,
        public readonly array $options,
        public readonly bool $dryRun,
    ) {}

    public function can(string $permission): bool
    {
        return Gate::forUser($this->user)->allows($permission);
    }

    /** Rows whose key matches an existing record update it (default) or are skipped. */
    public function updateExisting(): bool
    {
        return (bool) ($this->options['update_existing'] ?? true);
    }

    /**
     * @template T
     *
     * @param  callable(): T  $resolve
     * @return T
     */
    public function remember(string $key, callable $resolve): mixed
    {
        if (! array_key_exists($key, $this->memo)) {
            $this->memo[$key] = $resolve();
        }

        return $this->memo[$key];
    }

    public function put(string $key, mixed $value): void
    {
        $this->memo[$key] = $value;
    }

    public function forget(string $key): void
    {
        unset($this->memo[$key]);
    }
}
