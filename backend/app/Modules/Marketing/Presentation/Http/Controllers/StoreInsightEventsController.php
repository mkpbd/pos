<?php

namespace App\Modules\Marketing\Presentation\Http\Controllers;

use App\Modules\Marketing\Application\Actions\RecordPageEvents;
use App\Modules\Shared\Domain\CampaignAttribution;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * B15: store builder pages report what shoppers saw and clicked (navigator.sendBeacon).
 */
class StoreInsightEventsController
{
    /** The largest beacon body accepted, in bytes. */
    public const MAX_BYTES = 65536;

    /**
     * Record page insight events
     *
     * A JSON body (also as text/plain, as some sendBeacon calls send it): `{document_id,
     * version, path?, device: desktop|tablet|mobile, seq (0 = first beacon of a page view),
     * events?: [{t: view, node} | {t: click, node, el?, x: 0–1, y: 0–1}] (at most 50 used),
     * scroll?: 0|25|50|75|100, scroll_from?: 0|25|50|75, vitals?: {lcp_ms?, cls?, inp_ms?}}`.
     * 202 `{recorded, accepted, ignored}` — not recorded for bots, documents that are not
     * published pages of this store, or unknown versions; unknown nodes and malformed events are
     * ignored. Nothing personal is stored (no ip, user agent or cookie); `path` and `el` are not
     * kept. 413 PAYLOAD_TOO_LARGE above 64 KB; 422 for malformed top-level fields.
     *
     * B13: `arms?: {<A/B test id>: A|B}` (at most 3 used) on every beacon of a page view — the
     * versions it shows; tests not running in that version and bad entries are ignored.
     */
    public function __invoke(Request $request, RecordPageEvents $record): JsonResponse
    {
        $raw = $request->getContent();
        if (strlen($raw) > self::MAX_BYTES) {
            return ApiResponse::error('PAYLOAD_TOO_LARGE', 'The beacon is too large.', 413);
        }
        $input = $request->isJson() ? $request->json()->all() : json_decode($raw, true);
        $milestones = [0, 25, 50, 75, 100];
        $data = Validator::make(is_array($input) ? $input : [], [
            'document_id' => ['required', 'uuid'],
            'version' => ['required', 'integer', 'min:1', 'max:1000000'],
            'path' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'device' => ['required', 'string', Rule::in(CampaignAttribution::DEVICES)],
            'seq' => ['required', 'integer', 'min:0', 'max:100000'],
            'events' => ['sometimes', 'nullable', 'array'],
            'scroll' => ['sometimes', 'nullable', 'integer', Rule::in($milestones)],
            'scroll_from' => ['sometimes', 'nullable', 'integer', Rule::in($milestones)],
            'vitals' => ['sometimes', 'nullable', 'array'],
            // B13: the A/B test versions shown (entries checked by RecordPageEvents).
            'arms' => ['sometimes', 'nullable', 'array'],
        ])->validate();

        return ApiResponse::success($record($data, $request->ip(), $request->userAgent()), 202);
    }
}
