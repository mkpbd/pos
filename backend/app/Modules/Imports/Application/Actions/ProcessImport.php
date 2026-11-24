<?php

namespace App\Modules\Imports\Application\Actions;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Services\ImportProcessor;
use App\Modules\Imports\Application\Support\ImportHandlerRegistry;
use App\Modules\Imports\Domain\ImportStatus;
use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Gate;
use Throwable;

/**
 * Runs a queued step of an import (dry run or run) outside the request: in the import's
 * organization and branch, as the user who uploaded it (so permissions, author columns and the
 * audit trail are that user's). A step that breaks marks the import failed with a message.
 */
final class ProcessImport
{
    public function __construct(
        private readonly ImportHandlerRegistry $handlers,
        private readonly ImportProcessor $processor,
        private readonly TenantContext $tenant,
    ) {}

    public function validate(string $importId): void
    {
        $this->step($importId, ImportStatus::Validating, function (Import $import, $handler, ImportContext $context) {
            $this->processor->validate($import, $handler, $context);
        });
    }

    public function run(string $importId): void
    {
        $this->step($importId, ImportStatus::Importing, function (Import $import, $handler, ImportContext $context) {
            $this->processor->run($import, $handler, $context);
        });
    }

    /**
     * Marks an import whose step died (worker killed, time-out) as failed.
     */
    public static function markFailed(string $importId, string $message): void
    {
        Import::query()->withoutGlobalScopes()->whereKey($importId)
            ->whereIn('status', [ImportStatus::Validating->value, ImportStatus::Importing->value])
            ->update(['status' => ImportStatus::Failed->value, 'message' => mb_substr($message, 0, 1000), 'finished_at' => now(), 'updated_at' => now()]);
    }

    /**
     * @param  callable(Import, ImportHandler, ImportContext): void  $work
     */
    private function step(string $importId, ImportStatus $expected, callable $work): void
    {
        $import = Import::query()->withoutGlobalScopes()->find($importId);
        if ($import === null || $import->status !== $expected) {
            return;
        }

        $guard = Auth::guard();
        $previous = $guard->user();

        try {
            $handler = $this->handlers->find($import->type)
                ?? throw new BusinessRuleViolation('IMPORT_TYPE_UNKNOWN', 'This import type is no longer available.');
            $user = $this->user($import);
            if (! Gate::forUser($user)->allows($handler->permission())) {
                throw new BusinessRuleViolation('IMPORT_FORBIDDEN', 'The user who uploaded the file may no longer run this import.');
            }

            $guard->setUser($user);
            $context = new ImportContext($import->id, $import->organization_id, $import->branch_id, $user, $import->options ?? [], $expected === ImportStatus::Validating);
            $this->tenant->runAs($import->organization_id, fn () => $work($import, $handler, $context), $import->branch_id);
        } catch (BusinessRuleViolation $e) {
            self::markFailed($import->id, $e->getMessage());
        } catch (Throwable $e) {
            report($e);
            self::markFailed($import->id, $expected === ImportStatus::Validating
                ? 'The file could not be checked (unexpected error). Try again, or contact support.'
                : 'The import stopped (unexpected error). Rows already imported stay; check the counts.');
        } finally {
            if ($previous !== null) {
                $guard->setUser($previous);
            } elseif (method_exists($guard, 'forgetUser')) {
                $guard->forgetUser();
            }
        }
    }

    private function user(Import $import): TenantUser&Authenticatable
    {
        $provider = Auth::createUserProvider(config('auth.guards.web.provider', 'users'));
        $user = $import->created_by === null ? null : $provider?->retrieveById($import->created_by);
        if (! $user instanceof TenantUser || ! $user instanceof Authenticatable || ! $user->isActive()
            || (! $user->isPlatformAdmin() && $user->organizationId() !== $import->organization_id)) {
            throw new BusinessRuleViolation('IMPORT_FORBIDDEN', 'The user who uploaded the file is no longer active.');
        }

        return $user;
    }
}
