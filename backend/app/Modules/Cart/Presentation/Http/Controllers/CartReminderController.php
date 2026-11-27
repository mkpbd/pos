<?php

namespace App\Modules\Cart\Presentation\Http\Controllers;

use App\Modules\Cart\Application\Services\CartReminders;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * BD2b: abandoned-cart reminders on Settings → Online store.
 */
class CartReminderController
{
    /**
     * Cart reminder counts
     *
     * `sent_30d`: reminders sent in the last 30 days; `ordered_30d`: of those, the customers who
     * placed a web order within 7 days after their reminder.
     */
    public function summary(CartReminders $reminders): JsonResponse
    {
        return ApiResponse::success($reminders->summary());
    }
}
