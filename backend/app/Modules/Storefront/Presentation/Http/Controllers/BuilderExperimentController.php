<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\ManageBuilderExperiments;
use App\Modules\Storefront\Domain\Builder\Experiments;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B13: start, stop and end (keep one version of) a page's A/B test. Each changes the draft only
 * (publish to make it live) and returns the document like a draft save.
 */
class BuilderExperimentController
{
    /**
     * Start an A/B test
     *
     * `{revision}` (the draft revision the editor has; 409 DRAFT_CONFLICT for a newer one) — a
     * draft or stopped test becomes `running` (started_at now) in the draft. 422
     * EXPERIMENT_NEEDS_BOTH_ARMS without sections of both versions, 422 EXPERIMENT_STATUS, 404
     * EXPERIMENT_NOT_FOUND. Audited.
     */
    public function start(Request $request, BuilderDocument $document, string $experiment, ManageBuilderExperiments $experiments): JsonResponse
    {
        return $this->document($experiments->start($document, $this->revision($request), $experiment));
    }

    /**
     * Stop an A/B test
     *
     * `{revision}` — a running test becomes `stopped` (ended_at now) in the draft; shoppers see
     * version A once published. 422 EXPERIMENT_STATUS, 404 EXPERIMENT_NOT_FOUND. Audited.
     */
    public function stop(Request $request, BuilderDocument $document, string $experiment, ManageBuilderExperiments $experiments): JsonResponse
    {
        return $this->document($experiments->stop($document, $this->revision($request), $experiment));
    }

    /**
     * Keep one version of an A/B test
     *
     * `{revision, arm: A|B}` — in the draft, the other version's sections are removed, the kept
     * ones become plain sections and the test ends with that winner. 422 EXPERIMENT_STATUS (already
     * ended), 404 EXPERIMENT_NOT_FOUND. Audited.
     */
    public function keep(Request $request, BuilderDocument $document, string $experiment, ManageBuilderExperiments $experiments): JsonResponse
    {
        $arm = $request->validate(['arm' => ['required', 'string', Rule::in(Experiments::ARMS)]])['arm'];

        return $this->document($experiments->keep($document, $this->revision($request), $experiment, $arm));
    }

    private function revision(Request $request): int
    {
        return (int) $request->validate(['revision' => ['required', 'integer', 'min:0']])['revision'];
    }

    private function document(BuilderDocument $document): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::document($document->load('publishedVersion')));
    }
}
