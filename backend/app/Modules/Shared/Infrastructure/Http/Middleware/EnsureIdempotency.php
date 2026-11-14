<?php

namespace App\Modules\Shared\Infrastructure\Http\Middleware;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Persistence\IdempotencyKey;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Makes a write endpoint safe to retry (route middleware "idempotent").
 *
 * The client sends a unique Idempotency-Key per logical operation and reuses it when it
 * retries (time-out, lost connection, double click). The first request claims the key;
 * a successful response is stored and replayed verbatim for every retry with the same key
 * and payload (header Idempotent-Replayed: true). Failed attempts release the key so the
 * operation can be retried after fixing the cause. Reusing a key for a different payload
 * is rejected, and so is a retry that arrives while the first attempt is still running.
 *
 * Keys are scoped (ADR-014): staff routes use `user:{id}`; storefront routes
 * (`idempotent:shopper`) use `customer:{account id}` or, for guests, `cart:{cart token hash}`
 * — a guest without a cart gets CART_EMPTY (there is nothing to check out). P2a:
 * `idempotent:visitor` (landing page order forms, no cart) uses `customer:{account id}` or
 * `session:{session id hash}`.
 */
class EnsureIdempotency
{
    public const HEADER = 'Idempotency-Key';

    /** A claim older than this is treated as abandoned (e.g. the worker died mid-request). */
    private const ABANDONED_AFTER_SECONDS = 120;

    public function handle(Request $request, Closure $next, string $mode = 'staff'): Response
    {
        $key = $request->header(self::HEADER);
        if (! is_string($key) || preg_match('/^[A-Za-z0-9_\-:.]{8,100}$/', $key) !== 1) {
            return ApiResponse::error('IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header (8–100 letters, digits or - _ : .) with this request.', 428);
        }

        $userId = null;
        if ($mode === 'shopper') {
            $scope = app()->bound(ShopperIdempotencyScope::class) ? app(ShopperIdempotencyScope::class)->resolve($request) : null;
            if ($scope === null) {
                return ApiResponse::error('CART_EMPTY', 'Your cart is empty.', 422);
            }
        } elseif ($mode === 'visitor') {
            // P2a: checkouts without a cart (landing page order forms) — the customer or the session.
            $scope = app()->bound(ShopperIdempotencyScope::class) ? app(ShopperIdempotencyScope::class)->resolveVisitor($request) : null;
            if ($scope === null) {
                return ApiResponse::error('SESSION_REQUIRED', 'Please reload the page and try again.', 419);
            }
        } else {
            $userId = (string) $request->user()?->getAuthIdentifier();
            $scope = 'user:'.$userId;
        }
        $fingerprint = $this->fingerprint($request);

        $claimed = IdempotencyKey::query()->insertOrIgnore([
            'id' => (string) Str::uuid7(),
            'scope' => $scope,
            'user_id' => $userId === '' ? null : $userId,
            'key' => $key,
            'fingerprint' => $fingerprint,
            'status' => 'processing',
            'created_at' => now(),
            'updated_at' => now(),
        ]) === 1;

        if (! $claimed) {
            $existing = IdempotencyKey::query()->where('scope', $scope)->where('key', $key)->first();

            if ($existing !== null && $existing->fingerprint !== $fingerprint) {
                return ApiResponse::error('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.', 409);
            }
            if ($existing !== null && $existing->status === 'completed') {
                return response((string) $existing->response_body, (int) $existing->response_status, [
                    'Content-Type' => 'application/json',
                    'Idempotent-Replayed' => 'true',
                ]);
            }
            $takenOver = $existing !== null && IdempotencyKey::query()
                ->whereKey($existing->id)
                ->where('status', 'processing')
                ->where('updated_at', '<', now()->subSeconds(self::ABANDONED_AFTER_SECONDS))
                ->update(['updated_at' => now()]) === 1;

            if (! $takenOver) {
                return ApiResponse::error('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'The same request is still being processed. Wait a moment and retry.', 409, [], ['Retry-After' => '2']);
            }
        }

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->release($scope, $key);

            throw $e;
        }

        if ($response->isSuccessful()) {
            IdempotencyKey::query()->where('scope', $scope)->where('key', $key)->update([
                'status' => 'completed',
                'response_status' => $response->getStatusCode(),
                'response_body' => $response->getContent(),
                'updated_at' => now(),
            ]);
        } else {
            $this->release($scope, $key);
        }

        return $response;
    }

    private function release(string $scope, string $key): void
    {
        IdempotencyKey::query()->where('scope', $scope)->where('key', $key)->where('status', 'processing')->delete();
    }

    private function fingerprint(Request $request): string
    {
        return hash('sha256', implode("\n", [
            $request->method(),
            $request->path(),
            (string) $request->header('X-Branch-Id'),
            json_encode($this->canonical($request->all()), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]));
    }

    private function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }

        return array_map($this->canonical(...), $value);
    }
}
