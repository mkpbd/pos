<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Festivals\SetupFestival;
use App\Modules\Storefront\Application\Festivals\StoreFestivals;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * B17: the festival calendar and one-click festival setup (Online store → Festivals). Reading
 * needs storefront.view, setting up storefront.manage; nothing here publishes.
 */
class FestivalController
{
    /**
     * Festival calendar
     *
     * The occasions of the next 12 months in the store's time zone, ordered by date: `[{key,
     * name, name_bn, kind: fixed|lunar|season, sale_wording, next: {year, starts_on, ends_on,
     * expected, note, note_bn}, suggested: {starts_at, ends_at}, setup: null | {year, starts_at,
     * ends_at, state: drafts_ready|live_on_dates|ended, landing_slug, documents: [{id, kind, key,
     * title, role: landing|home|bar, status: unpublished|changed|published, preview_url}]}}]`.
     */
    public function index(StoreFestivals $festivals): JsonResponse
    {
        return ApiResponse::success($festivals->list());
    }

    /**
     * Set up a festival
     *
     * `{year, starts_at, ends_at, include: {landing, home_hero, bar}, discount_id?, landing_slug?}`
     * → drafts from the occasion's built-in templates (campaign page, home hero with a schedule,
     * bar popup with dates; countdowns end with the window) — never published. Same occasion and
     * year again updates the same drafts. Returns `{festival, documents, publish_ids}`; publish
     * with POST /storefront/builder/publish-all. 404 unknown occasion; 422 VALIDATION_ERROR,
     * FESTIVAL_DATE_UNKNOWN, SLUG_TAKEN, DOCUMENT_INVALID, HOME_FULL. Audited.
     */
    public function setup(Request $request, string $key, SetupFestival $setup): JsonResponse
    {
        if (! FestivalCalendar::exists($key)) {
            throw new NotFoundHttpException('Unknown occasion.');
        }
        $data = $request->validate([
            'year' => ['required', 'integer', 'between:'.FestivalCalendar::YEARS[0].','.FestivalCalendar::YEARS[1]],
            'starts_at' => ['required', 'string', 'regex:'.self::INSTANT, 'date'],
            'ends_at' => ['required', 'string', 'regex:'.self::INSTANT, 'date'],
            'include' => ['required', 'array:landing,home_hero,bar'],
            'include.landing' => ['sometimes', 'boolean'],
            'include.home_hero' => ['sometimes', 'boolean'],
            'include.bar' => ['sometimes', 'boolean'],
            'discount_id' => ['sometimes', 'nullable', 'uuid'],
            'landing_slug' => ['sometimes', 'nullable', 'string', 'regex:/^[a-z0-9-]{2,60}$/', 'not_in:home'],
        ], [
            'starts_at.regex' => 'Use an ISO 8601 date and time with a time zone, e.g. 2026-12-01T00:00:00+06:00.',
            'ends_at.regex' => 'Use an ISO 8601 date and time with a time zone, e.g. 2026-12-01T00:00:00+06:00.',
            'landing_slug.regex' => 'Use 2–60 lower-case letters, digits and dashes.',
        ]);
        $include = $data['include'];
        if (! in_array(true, array_map(fn ($value) => (bool) $value, $include), true)) {
            throw ValidationException::withMessages(['include' => 'Choose at least one thing to create.']);
        }

        return ApiResponse::success($setup($key, [
            'year' => (int) $data['year'],
            'starts_at' => $data['starts_at'],
            'ends_at' => $data['ends_at'],
            'include' => array_map(fn ($value) => (bool) $value, $include),
            'discount_id' => $data['discount_id'] ?? null,
            'landing_slug' => $data['landing_slug'] ?? null,
        ]));
    }

    /** An instant with a time zone offset (as the builder's schedules take). */
    private const INSTANT = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/';
}
