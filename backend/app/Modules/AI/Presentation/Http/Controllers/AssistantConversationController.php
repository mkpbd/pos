<?php

namespace App\Modules\AI\Presentation\Http\Controllers;

use App\Modules\AI\Application\Assistants\ShopperConversations;
use App\Modules\AI\Infrastructure\Models\AssistantConversation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * AI2b: the online store assistant's conversations for staff (storefront.manage). Kept for 30
 * days; customer names only with customers.view.
 */
class AssistantConversationController
{
    private const DATE = ['sometimes', 'nullable', 'date_format:Y-m-d'];

    /**
     * Shop assistant conversations
     *
     * `?search=&from=&to=&handed_off=1|0&page=&per_page=` (dates store-local, `search` in the
     * messages) → `[{id, started_at, last_message_at, language, signed_in, customer_name (null
     * without customers.view), message_count, handed_off, status, preview (first shopper message ≤ 80)}]`,
     * newest first, 20 per page.
     */
    public function index(Request $request, ShopperConversations $conversations): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'from' => self::DATE,
            'to' => [...self::DATE, 'after_or_equal:from'],
            'handed_off' => ['sometimes', 'nullable', 'in:0,1,true,false'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $page = $conversations->list($filters, (int) ($filters['per_page'] ?? 20));
        $rows = $conversations->rows($page->items(), $request->user()->can('customers.view'));
        $byId = array_column($rows, null, 'id');

        return ApiResponse::paginated($page, fn (AssistantConversation $c) => new JsonResource($byId[$c->id]));
    }

    /**
     * Shop assistant transcript
     *
     * The row of the list plus `messages: [{id, role, text, tools: string[], status, created_at}]`.
     */
    public function show(Request $request, string $conversation, ShopperConversations $conversations): JsonResponse
    {
        $found = $conversations->find($conversation);
        if ($found === null) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success($conversations->transcript($found, $request->user()->can('customers.view')));
    }

    /**
     * Shop assistant summary
     *
     * `?from=&to=` (store-local dates, default the last 30 days) → `{from, to, conversations,
     * messages, handed_off, handed_off_share (0–1), unavailable, limit, budget, top_tools: [{name, count}] ≤ 5}`.
     */
    public function summary(Request $request, ShopperConversations $conversations): JsonResponse
    {
        $data = $request->validate(['from' => self::DATE, 'to' => [...self::DATE, 'after_or_equal:from']]);

        return ApiResponse::success($conversations->summary($data['from'] ?? null, $data['to'] ?? null));
    }
}
