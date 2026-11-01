<?php

namespace App\Modules\Customers\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;
use App\Modules\Customers\Application\Contracts\CustomerReviewStats;
use App\Modules\Customers\Application\Contracts\CustomerShoppingLists;
use App\Modules\Customers\Application\Contracts\CustomerWebOrders;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * The online side of a customer (E10b) for the admin customer card, composed from the
 * modules that own it through contracts this module declares (CustomerAccounts, Orders,
 * Reviews, Cart) — Customers depends on none of them.
 */
class CustomerWebActivityController
{
    /**
     * Customer web activity
     *
     * `{account: {email, verified, created_at, last_login_at, status} | null, orders: {count,
     * total_spent (paid − refunded), last_order_at, average_order}, returns_count, reviews:
     * {count, pending}, wishlist_count, cart: {item_count, updated_at} | null, recent_orders:
     * [{id, number, placed_at, status, status_label, payment_status, total, currency}] (5
     * newest)}`. Another organization's customer: 404.
     */
    public function __invoke(
        Customer $customer,
        CustomerOnlineAccounts $accounts,
        CustomerWebOrders $orders,
        CustomerReviewStats $reviews,
        CustomerShoppingLists $lists,
    ): JsonResponse {
        $account = $accounts->forCustomer($customer->id);
        $orderSummary = $orders->summary($customer->id) + [
            'orders' => ['count' => 0, 'total_spent' => '0.00', 'last_order_at' => null, 'average_order' => '0.00'],
            'returns_count' => 0,
            'recent_orders' => [],
        ];
        $reviewSummary = $reviews->summary($customer->id) + ['count' => 0, 'pending' => 0];
        $listSummary = $lists->summary($customer->id) + ['wishlist_count' => 0, 'cart' => null];

        return ApiResponse::success([
            'account' => $account === null ? null : [
                'email' => $account['email'],
                'verified' => $account['email_verified_at'] !== null,
                'created_at' => $account['created_at'],
                'last_login_at' => $account['last_login_at'],
                'status' => $account['status'],
            ],
            'orders' => $orderSummary['orders'],
            'returns_count' => $orderSummary['returns_count'],
            'reviews' => ['count' => $reviewSummary['count'], 'pending' => $reviewSummary['pending']],
            'wishlist_count' => $listSummary['wishlist_count'],
            'cart' => $listSummary['cart'],
            'recent_orders' => $orderSummary['recent_orders'],
        ]);
    }
}
