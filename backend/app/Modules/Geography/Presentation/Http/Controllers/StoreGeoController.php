<?php

namespace App\Modules\Geography\Presentation\Http\Controllers;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public reference data for address forms. The same for every store, cacheable for a day.
 *
 * E12b: `name` is in the request's language (`?lang=bn`: the Bangla name, ordered by it;
 * `name_bn` stays as before).
 */
class StoreGeoController
{
    /**
     * Divisions
     *
     * The eight divisions of Bangladesh by name (English, or Bangla with `lang=bn`).
     */
    public function divisions(GeoDirectory $geo, LocaleContext $locale): JsonResponse
    {
        return $this->cached(ApiResponse::success($this->localize($geo->divisions(), $locale->current())));
    }

    /**
     * Districts
     *
     * Districts of `division` (id), or all 64 without the filter, by name (English, or Bangla
     * with `lang=bn`).
     */
    public function districts(Request $request, GeoDirectory $geo, LocaleContext $locale): JsonResponse
    {
        $division = $request->validate(['division' => ['sometimes', 'integer', 'min:1']])['division'] ?? null;

        return $this->cached(ApiResponse::success($this->localize($geo->districts($division === null ? null : (int) $division), $locale->current())));
    }

    /**
     * @param  list<array{name: string, name_bn: string}>  $rows  by English name
     * @return list<array<string, mixed>>
     */
    private function localize(array $rows, string $locale): array
    {
        if ($locale !== LocaleContext::BN) {
            return $rows;
        }
        $rows = array_map(fn (array $row) => ['name' => $row['name_bn']] + $row, $rows);
        usort($rows, fn (array $a, array $b) => strcmp($a['name_bn'], $b['name_bn']));

        return $rows;
    }

    private function cached(JsonResponse $response): JsonResponse
    {
        return $response->setPublic()->setMaxAge(86400);
    }
}
