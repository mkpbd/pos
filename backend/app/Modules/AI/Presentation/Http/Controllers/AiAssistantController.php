<?php

namespace App\Modules\AI\Presentation\Http\Controllers;

use App\Modules\AI\Application\Assistants\AskAssistant;
use App\Modules\AI\Application\Assistants\ReorderExplainer;
use App\Modules\AI\Presentation\Http\Requests\AskRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Ask AI and the reorder explanation (Phase 8). Both need AI to be on (else 503
 * AI_UNAVAILABLE) and budget left (else 429 AI_BUDGET_EXCEEDED); 20 requests per minute per user.
 */
class AiAssistantController
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Ask AI
     *
     * `question` (2–1000 chars), optional `branch_id` (an accessible branch the question is about
     * by default) and `history` (≤ 6 earlier turns `{role: user|assistant, content}`, alternating,
     * starting with the user and ending with the assistant; nothing is stored on the server).
     * The model answers only from read-only tools over the user's reports. Response: `answer`
     * (Markdown), `report` (the last registry report used: key, title, params, columns, rows ≤ 50,
     * totals, total_rows, omitted_columns, link) or null, `tools_used`, `usage`, `model`,
     * `refused`, `truncated`.
     */
    public function ask(AskRequest $request, AskAssistant $assistant): JsonResponse
    {
        $data = $request->validated();

        return ApiResponse::success($assistant->ask(
            $this->user($request),
            $this->tenant->requireOrganization(),
            (string) $data['question'],
            $data['branch_id'] ?? null,
            array_values($data['history'] ?? []),
        ));
    }

    /**
     * Explain reorder suggestions
     *
     * `store_id`: an active store of an accessible branch. A prioritised narrative over the
     * store's deterministic reorder suggestions (the suggestions themselves are unchanged).
     * Needs `ai.ask` and `purchases.view`.
     */
    public function explainReorder(Request $request, ReorderExplainer $explainer): JsonResponse
    {
        $data = $request->validate(['store_id' => ['required', 'uuid']]);

        return ApiResponse::success($explainer->explain($this->user($request), $this->tenant->requireOrganization(), (string) $data['store_id']));
    }

    private function user(Request $request): TenantUser&Authorizable
    {
        /** @var TenantUser&Authorizable */
        return $request->user();
    }
}
