<?php

namespace App\Modules\AI\Presentation\Http\Controllers;

use App\Modules\AI\Application\Assistants\ShopperAssistant;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;

/**
 * AI2b: the online store's shopper assistant (store host; guests and signed-in shoppers).
 */
class StoreAssistantController
{
    private const TOKEN_RULES = ['string', 'min:20', 'max:100', 'regex:/^[A-Za-z0-9_-]+$/'];

    /**
     * Ask the shop assistant
     *
     * `{conversation_token?, message (≤ 500), language: en|bn, page?: {type: product|category|other, slug?}}`
     * → `{conversation_token, reply: {text, products ≤ 4, links ≤ 3, handoff: {type, url}|null}, status:
     * ok|unavailable|limit|budget, remaining_messages}`. Always 200 with a fixed reply when the
     * assistant cannot answer (off, AI unavailable, budget, a limit) — `conversation_token` null
     * when no conversation could be started. An unknown token or one of another shopper starts a
     * new conversation (a new token). Per IP 10 per minute and 60 per hour (429 beyond).
     */
    public function send(Request $request, ShopperAssistant $assistant): JsonResponse
    {
        $request->merge(['message' => is_string($request->input('message')) ? trim($request->input('message')) : $request->input('message')]);
        $data = $request->validate([
            'conversation_token' => ['sometimes', 'nullable', ...self::TOKEN_RULES],
            'message' => ['required', 'string', 'max:'.ShopperAssistant::MAX_MESSAGE_LENGTH],
            'language' => ['required', Rule::in(LocaleContext::SUPPORTED)],
            'page' => ['sometimes', 'nullable', 'array:type,slug'],
            'page.type' => ['required_with:page', Rule::in(['product', 'category', 'other'])],
            'page.slug' => ['sometimes', 'nullable', 'string', 'max:200', 'regex:/^[\p{L}\p{N}-]+$/u'],
        ]);

        return ApiResponse::success($assistant->send(
            self::customerId(),
            $data['conversation_token'] ?? null,
            $data['message'],
            $data['language'],
            isset($data['page']) ? ['type' => $data['page']['type'], 'slug' => $data['page']['slug'] ?? null] : null,
        ))->header('Cache-Control', 'no-store, private');
    }

    /**
     * Reopen the shop assistant
     *
     * The token's conversation: `{conversation_token, messages: [{id, role, text, products, links,
     * handoff, status, created_at}] (last 20, oldest first), remaining_messages}`; an unknown,
     * expired or other shopper's token → `{conversation_token: null, messages: [], remaining_messages: 20}`.
     */
    public function current(Request $request, ShopperAssistant $assistant): JsonResponse
    {
        $data = $request->validate(['conversation_token' => ['sometimes', 'nullable', ...self::TOKEN_RULES]]);

        return ApiResponse::success($assistant->current(self::customerId(), $data['conversation_token'] ?? null))
            ->header('Cache-Control', 'no-store, private');
    }

    private static function customerId(): ?string
    {
        $account = Auth::guard('customer')->user();

        return $account instanceof CustomerAccount ? $account->customer_id : null;
    }
}
