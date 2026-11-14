<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Actions\RecordVisit;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * P2a: the storefront reports a visit that arrived from a campaign (once per session).
 */
class StoreVisitController
{
    /**
     * Record a campaign visit
     *
     * `{path, utm_source?, utm_medium?, utm_campaign?, utm_content?, utm_term?, code?,
     * referrer_host?}` → `{recorded: bool}` (false: a bot, or the visit names no campaign, short
     * link or UTM source / campaign). Nothing personal is stored.
     */
    public function __invoke(Request $request, RecordVisit $record): JsonResponse
    {
        $data = $request->validate([
            'path' => ['required', 'string', 'max:2000'],
            'utm_source' => ['sometimes', 'nullable', 'string', 'max:500'],
            'utm_medium' => ['sometimes', 'nullable', 'string', 'max:500'],
            'utm_campaign' => ['sometimes', 'nullable', 'string', 'max:500'],
            'utm_content' => ['sometimes', 'nullable', 'string', 'max:500'],
            'utm_term' => ['sometimes', 'nullable', 'string', 'max:500'],
            'code' => ['sometimes', 'nullable', 'string', 'max:64'],
            'referrer_host' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        return ApiResponse::success(['recorded' => $record($data, $request->ip(), $request->userAgent())]);
    }
}
