<?php

namespace App\Modules\Reviews\Infrastructure;

use App\Modules\Orders\Application\Contracts\OrderLineReviews;
use App\Modules\Reviews\Infrastructure\Models\Review;

final class EloquentOrderLineReviews implements OrderLineReviews
{
    public function ofCustomer(string $customerId, array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        return Review::query()->where('customer_id', $customerId)->whereIn('product_id', array_values(array_unique($productIds)))
            ->get(['id', 'product_id', 'rating', 'status'])
            ->mapWithKeys(fn (Review $r) => [$r->product_id => ['id' => $r->id, 'rating' => $r->rating, 'status' => $r->status->value]])
            ->all();
    }
}
