<?php

namespace App\Modules\Geography\Presentation\Http\Controllers;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public reference data for address forms. The same for every store, cacheable for a day.
 */
class StoreGeoController
{
    /**
     * Divisions
     *
     * The eight divisions of Bangladesh by English name.
     */
    public function divisions(GeoDirectory $geo): JsonResponse
    {
        return $this->cached(ApiResponse::success($geo->divisions()));
    }

    /**
     * Districts
     *
     * Districts of `division` (id), or all 64 without the filter, by English name.
     */
    public function districts(Request $request, GeoDirectory $geo): JsonResponse
    {
        $division = $request->validate(['division' => ['sometimes', 'integer', 'min:1']])['division'] ?? null;

        return $this->cached(ApiResponse::success($geo->districts($division === null ? null : (int) $division)));
    }

    private function cached(JsonResponse $response): JsonResponse
    {
        return $response->setPublic()->setMaxAge(86400);
    }
}
