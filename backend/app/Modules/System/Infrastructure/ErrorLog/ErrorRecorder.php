<?php

namespace App\Modules\System\Infrastructure\ErrorLog;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Services\OpsAlerts;
use App\Modules\System\Domain\ErrorLog\ErrorText;
use App\Modules\System\Infrastructure\Models\ErrorEvent;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\QueryException;
use Illuminate\Database\RecordsNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Session\TokenMismatchException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * G1b: records unexpected errors in `error_events` (one row per fingerprint, counting occurrences).
 *
 * Hooked into the exception handler's report step (bootstrap/app.php), next to normal logging.
 * It writes through its own database connection (`error_log`, a copy of the default one), so an
 * error inside a transaction that is rolled back is still recorded. It never throws: a failure
 * while recording (database down, …) is only logged, and a static guard stops recursion.
 */
final class ErrorRecorder
{
    public const CONNECTION = 'error_log';

    private const TRACE_FRAMES = 30;

    /** Expected outcomes that are not errors of the application. */
    private const SKIPPED = [
        ValidationException::class,
        AuthenticationException::class,
        AuthorizationException::class,
        ModelNotFoundException::class,
        RecordsNotFoundException::class,
        TokenMismatchException::class,
        ThrottleRequestsException::class,
        BusinessRuleViolation::class,
        // Rendered as 409 CONFLICT: a unique index caught a race between two requests.
        UniqueConstraintViolationException::class,
    ];

    private static bool $recording = false;

    public function __construct(private readonly OpsAlerts $alerts) {}

    /**
     * Entry point for the exception handler: never throws.
     */
    public static function report(Throwable $e): void
    {
        if (self::$recording) {
            return;
        }

        try {
            if (! config('pos.error_log.enabled')) {
                return;
            }
            app(self::class)->record($e);
        } catch (Throwable $failure) {
            self::logFailure($failure);
        }
    }

    public static function shouldRecord(Throwable $e): bool
    {
        if ($e instanceof HttpExceptionInterface && $e->getStatusCode() < 500) {
            return false;
        }
        foreach (self::SKIPPED as $class) {
            if ($e instanceof $class) {
                return false;
            }
        }

        return true;
    }

    public function record(Throwable $e): void
    {
        if (self::$recording || ! self::shouldRecord($e)) {
            return;
        }

        self::$recording = true;
        try {
            $this->write($e);
        } catch (Throwable $failure) {
            self::logFailure($failure);
        } finally {
            self::$recording = false;
        }
    }

    private function write(Throwable $e): void
    {
        $now = Carbon::now()->format('Y-m-d H:i:s.uP');
        $class = $e::class;
        $file = self::relativePath($e->getFile());
        $message = self::message($e);
        $fingerprint = ErrorText::fingerprint($class, $file, $e->getLine(), $message);
        $where = self::where();

        $row = DB::connection(self::CONNECTION)->selectOne(<<<'SQL'
            WITH previous AS (SELECT status FROM error_events WHERE fingerprint = ?)
            INSERT INTO error_events (
                id, fingerprint, exception_class, message, file, line, trace, occurrences, first_seen_at, last_seen_at,
                last_method, last_path, last_request_id, last_user_id, last_organization_id, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
            ON CONFLICT (fingerprint) DO UPDATE SET
                occurrences = error_events.occurrences + 1,
                message = EXCLUDED.message,
                trace = EXCLUDED.trace,
                last_seen_at = EXCLUDED.last_seen_at,
                last_method = EXCLUDED.last_method,
                last_path = EXCLUDED.last_path,
                last_request_id = EXCLUDED.last_request_id,
                last_user_id = EXCLUDED.last_user_id,
                last_organization_id = EXCLUDED.last_organization_id,
                status = CASE WHEN error_events.status = 'resolved' THEN 'open' ELSE error_events.status END,
                resolved_at = CASE WHEN error_events.status = 'resolved' THEN NULL ELSE error_events.resolved_at END,
                resolved_by = CASE WHEN error_events.status = 'resolved' THEN NULL ELSE error_events.resolved_by END,
                updated_at = EXCLUDED.updated_at
            RETURNING id, status, occurrences, (SELECT status FROM previous) AS previous_status
            SQL, [
            $fingerprint,
            (string) Str::uuid7(), $fingerprint, ErrorText::truncate($class, 255), $message, ErrorText::truncate($file, 500),
            $e->getLine(), self::trace($e), $now, $now,
            $where['method'], $where['path'], $where['request_id'], $where['user_id'], $where['organization_id'],
            $now, $now,
        ]);

        if ($row === null || $row->status === ErrorEvent::IGNORED) {
            return;
        }

        $isNew = $row->previous_status === null;
        $isBack = $row->previous_status === ErrorEvent::RESOLVED;
        if (($isNew || $isBack) && $this->alerts->canSend() && $this->claimNotification($row->id)) {
            $this->alerts->send(
                'error',
                ($isNew ? 'New error: ' : 'Error is back: ').class_basename($class),
                array_values(array_filter([
                    $class,
                    $message,
                    $where['path'] !== null ? 'Path: '.$where['method'].' '.$where['path'] : null,
                    'Occurrences: '.$row->occurrences,
                ])),
                OpsAlerts::adminUrl('system-status/errors/'.$row->id),
                'Open the error',
            );
        }
    }

    /**
     * At most one alert per fingerprint and hour, even with concurrent workers.
     */
    private function claimNotification(string $id): bool
    {
        $now = Carbon::now();

        return DB::connection(self::CONNECTION)->update(
            'UPDATE error_events SET notified_at = ? WHERE id = ? AND (notified_at IS NULL OR notified_at < ?)',
            [$now->format('Y-m-d H:i:s.uP'), $id, $now->copy()->subHour()->format('Y-m-d H:i:s.uP')],
        ) === 1;
    }

    /**
     * The stored message: a query error keeps its SQLSTATE and the SQL without bindings (the
     * bound values may be customer data); then the general sanitising.
     */
    public static function message(Throwable $e): string
    {
        $message = $e->getMessage();

        if ($e instanceof QueryException) {
            $state = (string) $e->getCode();
            $message = "SQLSTATE[{$state}] ".$e->getSql();
            // Class 42 (undefined table / column, syntax): the driver's first line names schema
            // objects, never data values — worth keeping.
            if (str_starts_with($state, '42') && $e->getPrevious() !== null) {
                $driver = ErrorText::firstLine((string) preg_replace('/^SQLSTATE\[\w+\]:\s*/', '', $e->getPrevious()->getMessage()), 300);
                $message = $driver.' — '.$message;
            }
        }

        $message = ErrorText::sanitise($message);

        return $message === '' ? '(no message)' : $message;
    }

    /**
     * Up to TRACE_FRAMES frames as "#n file(line): Class->method()", relative paths, no arguments.
     */
    public static function trace(Throwable $e): string
    {
        $lines = [];
        $frames = $e->getTrace();
        foreach (array_slice($frames, 0, self::TRACE_FRAMES) as $i => $frame) {
            $where = isset($frame['file']) ? self::relativePath((string) $frame['file']).'('.($frame['line'] ?? '?').')' : '[internal function]';
            $call = ($frame['class'] ?? '').($frame['type'] ?? '').($frame['function'] ?? '').'()';
            $lines[] = "#{$i} {$where}: {$call}";
        }
        if (count($frames) > self::TRACE_FRAMES) {
            $lines[] = '… '.(count($frames) - self::TRACE_FRAMES).' more frame(s)';
        }

        return implode("\n", $lines);
    }

    public static function relativePath(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        $base = rtrim(str_replace('\\', '/', base_path()), '/').'/';

        return str_starts_with(strtolower($path), strtolower($base)) ? substr($path, strlen($base)) : $path;
    }

    /**
     * Where the error happened: the HTTP request (method, path without query string), the
     * request id (also set for queued jobs) and who was acting. Each part is best effort.
     *
     * @return array{method: ?string, path: ?string, request_id: ?string, user_id: ?string, organization_id: ?string}
     */
    private static function where(): array
    {
        $where = ['method' => null, 'path' => null, 'request_id' => null, 'user_id' => null, 'organization_id' => null];

        try {
            $request = app()->bound('request') ? request() : null;
            if ($request !== null && $request->route() !== null) {
                $where['method'] = $request->getMethod();
                $where['path'] = ErrorText::truncate('/'.ltrim($request->path(), '/'), 500);
            }
        } catch (Throwable) {
        }
        try {
            $id = Context::get('request_id');
            $where['request_id'] = is_string($id) ? substr($id, 0, 64) : null;
        } catch (Throwable) {
        }
        try {
            // hasUser(): never a database lookup while reporting.
            $user = Auth::hasUser() ? Auth::user() : null;
            $where['user_id'] = $user instanceof TenantUser ? (string) $user->getAuthIdentifier() : null;
        } catch (Throwable) {
        }
        try {
            $tenant = app(TenantContext::class);
            $where['organization_id'] = $tenant->hasOrganization() ? $tenant->organizationId() : null;
        } catch (Throwable) {
        }

        return $where;
    }

    private static function logFailure(Throwable $failure): void
    {
        try {
            Log::warning('The error could not be recorded in the error log.', ['exception' => $failure::class, 'message' => ErrorText::sanitise($failure->getMessage(), 500)]);
        } catch (Throwable) {
        }
    }
}
