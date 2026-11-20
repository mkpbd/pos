<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Storefront\Infrastructure\Models\StorefrontRedirect;

/**
 * B16: a storefront redirect for the admin API.
 */
final class RedirectPresenter
{
    /**
     * @return array{id: string, from_path: string, to_path: string, type: int, source: string, hits: int, last_hit_at: ?string, created_at: ?string, updated_at: ?string}
     */
    public static function redirect(StorefrontRedirect $redirect): array
    {
        return [
            'id' => $redirect->id,
            'from_path' => $redirect->from_path,
            'to_path' => $redirect->to_path,
            'type' => (int) $redirect->type,
            'source' => $redirect->source,
            'hits' => (int) $redirect->hits,
            'last_hit_at' => $redirect->last_hit_at?->toIso8601String(),
            'created_at' => $redirect->created_at?->toIso8601String(),
            'updated_at' => $redirect->updated_at?->toIso8601String(),
        ];
    }
}
