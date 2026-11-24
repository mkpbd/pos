<?php

namespace App\Modules\Sms\Presentation\Http\Controllers;

use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Sms\Application\Actions\SendTestSms;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Presentation\Http\Support\SmsPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * BD1a: the SMS message log and test messages.
 */
class SmsMessageController
{
    /**
     * SMS messages
     *
     * Filters `status`, `purpose`, `search` (phone digits), `from` / `to` (dates, inclusive).
     * Newest first. Rows: `{id, to_phone, purpose, body (codes masked), segments, encoding,
     * driver, status, error, attempts, created_at, sent_at, related: {type, id}|null}`.
     */
    public function index(Request $request, SmsPresenter $presenter): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::in(SmsMessage::STATUSES)],
            'purpose' => ['sometimes', Rule::in(SmsMessage::PURPOSES)],
            'search' => ['sometimes', 'nullable', 'string', 'max:20'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ]);
        $digits = preg_replace('/\D/', '', (string) $request->query('search', '')) ?? '';
        if (str_starts_with($digits, '880')) {
            $digits = substr($digits, 2);
        }

        $page = SmsMessage::query()
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('purpose'), fn (Builder $q, string $v) => $q->where('purpose', $v))
            ->when($digits !== '', fn (Builder $q) => $q->where('to_phone', 'like', '%'.$digits.'%'))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('created_at', '>=', now()->parse($v)->startOfDay()))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('created_at', '<', now()->parse($v)->addDay()->startOfDay()))
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(ListQuery::perPage($request));

        return ApiResponse::paginated($page, fn (SmsMessage $m) => new JsonResource($presenter->message($m)));
    }

    /**
     * Send a test SMS
     *
     * `{phone, message?}` (default "{shop}: test message from your POS.") — sent right away →
     * `{status: sent|failed, error, provider_status, provider_response, segments, encoding}`.
     * `SMS_UNAVAILABLE` (422) when SMS is off or not set up. 5 per minute.
     */
    public function test(Request $request, SendTestSms $send): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:20'],
            'message' => ['sometimes', 'nullable', 'string', 'max:1000'],
        ]);
        $phone = BangladeshMobile::normalize($data['phone'])
            ?? throw ValidationException::withMessages(['phone' => ['Enter a Bangladeshi mobile number, e.g. 01712345678.']]);

        return ApiResponse::success($send($phone, $data['message'] ?? null));
    }
}
