<?php

namespace App\Modules\Shared\Infrastructure\Http\Responses;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Context;

/**
 * Single source of truth for the API response envelope.
 *
 * Success: { "success": true,  "data": ..., "meta": { "request_id": ..., ... } }
 * Error:   { "success": false, "error": { "code", "message", "details" }, "meta": { "request_id": ... } }
 */
final class ApiResponse
{
    /**
     * @param  array<string, mixed>  $meta
     */
    public static function success(mixed $data = null, int $status = 200, array $meta = []): JsonResponse
    {
        if ($data instanceof JsonResource) {
            $data = $data->resolve(request());
        }

        return new JsonResponse([
            'success' => true,
            'data' => $data,
            'meta' => self::meta($meta),
        ], $status);
    }

    public static function created(mixed $data = null): JsonResponse
    {
        return self::success($data, 201);
    }

    public static function noContent(): JsonResponse
    {
        return new JsonResponse(null, 204);
    }

    /**
     * @param  class-string<JsonResource>|callable(mixed): JsonResource  $resource  resource class, or a factory per item
     */
    public static function paginated(LengthAwarePaginator $paginator, string|callable $resource): JsonResponse
    {
        $items = is_string($resource)
            ? $resource::collection($paginator->items())->resolve(request())
            : array_map(fn ($item) => $resource($item)->resolve(request()), $paginator->items());

        return self::success(
            $items,
            meta: ['pagination' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
            ]],
        );
    }

    /**
     * @param  array<string, mixed>  $details
     * @param  array<string, string>  $headers
     */
    public static function error(string $code, string $message, int $status, array $details = [], array $headers = []): JsonResponse
    {
        return new JsonResponse([
            'success' => false,
            'error' => [
                'code' => $code,
                'message' => $message,
                'details' => (object) $details,
            ],
            'meta' => self::meta(),
        ], $status, $headers);
    }

    /**
     * @param  array<string, mixed>  $extra
     * @return array<string, mixed>
     */
    private static function meta(array $extra = []): array
    {
        return ['request_id' => Context::get('request_id')] + $extra;
    }
}
