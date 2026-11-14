<?php

namespace App\Modules\Orders;

use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Cart\Presentation\Http\Support\CartCookie;
use App\Modules\Customers\Application\Contracts\CustomerWebOrders;
use App\Modules\Marketing\Application\Contracts\AttributedOrders;
use App\Modules\Orders\Application\Contracts\OrderBaskets;
use App\Modules\Orders\Application\Contracts\OrderLineReviews;
use App\Modules\Orders\Application\Contracts\PurchaseVerifier;
use App\Modules\Orders\Application\Events\OrderCancelledByCustomer;
use App\Modules\Orders\Application\Events\OrderCancelledWithRefund;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Application\Events\OrderReturnRequested;
use App\Modules\Orders\Application\Events\OrderReturnUpdated;
use App\Modules\Orders\Application\Services\NoOrderLineReviews;
use App\Modules\Orders\Infrastructure\Console\ExpirePendingOrdersCommand;
use App\Modules\Orders\Infrastructure\EloquentAttributedOrders;
use App\Modules\Orders\Infrastructure\EloquentCustomerWebOrders;
use App\Modules\Orders\Infrastructure\EloquentOrderBaskets;
use App\Modules\Orders\Infrastructure\EloquentPurchaseVerifier;
use App\Modules\Orders\Infrastructure\Notifications\SendOrderCancelledNotifications;
use App\Modules\Orders\Infrastructure\Notifications\SendOrderCancelledWithRefundNotifications;
use App\Modules\Orders\Infrastructure\Notifications\SendOrderPlacedNotifications;
use App\Modules\Orders\Infrastructure\Notifications\SendOrderReturnNotifications;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Web orders (ADR-003): storefront checkout (preview, placement with stock leaving the
 * fulfilment store, COD and bank transfer), the guest/customer order page, the staff web
 * orders list and workflow (confirm payment, process, ship, deliver, record COD payment,
 * cancel with restock), the confirmation e-mail and staff notification, and the scheduled
 * expiry of unpaid bank-transfer orders (`orders:expire-pending`); the customer's own orders
 * (E9: history, detail, cancel, re-order) and the `PurchaseVerifier` the Reviews module asks;
 * fulfilment (E10a): shipments with courier events, the orders board (filters, counts, bulk
 * processing), print data and couriers' COD remittances; online returns and refunds (E10b):
 * customer requests, staff approval, receipt with restock to the original batches, refunds
 * through the payments ledger, and the `CustomerWebOrders` summary for the customer card.
 */
class OrdersServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(PurchaseVerifier::class, EloquentPurchaseVerifier::class);
        // E10b: web orders and returns on the admin customer card.
        $this->app->bind(CustomerWebOrders::class, EloquentCustomerWebOrders::class);
        // Replaced by the Reviews module when it is installed.
        $this->app->bindIf(OrderLineReviews::class, NoOrderLineReviews::class);
        // P1b: web orders as baskets for "frequently bought together" (OnlineCatalog).
        $this->app->bind(OrderBaskets::class, EloquentOrderBaskets::class);
        // P2a: web orders by campaign attribution (declared by Marketing).
        $this->app->bind(AttributedOrders::class, EloquentAttributedOrders::class);
    }

    public function boot(): void
    {
        parent::boot();

        Event::listen(OrderPlaced::class, SendOrderPlacedNotifications::class);
        Event::listen(OrderCancelledByCustomer::class, SendOrderCancelledNotifications::class);
        Event::listen(OrderCancelledWithRefund::class, SendOrderCancelledWithRefundNotifications::class);
        Event::listen(OrderReturnRequested::class, [SendOrderReturnNotifications::class, 'requested']);
        Event::listen(OrderReturnUpdated::class, [SendOrderReturnNotifications::class, 'updated']);

        // Checkout preview and placement: per IP and cart (ADR-015).
        RateLimiter::for('checkout', function (Request $request) {
            $customerId = Auth::guard('customer')->id();
            $token = CartCookie::token($request);
            $who = $customerId !== null ? 'customer:'.$customerId : ($token !== null ? 'cart:'.CartOwner::hashToken($token) : 'none');

            return Limit::perMinute((int) config('pos.checkout_rate_limit'))->by('checkout:'.$request->ip().'|'.$who);
        });

        if ($this->app->runningInConsole()) {
            $this->commands([ExpirePendingOrdersCommand::class]);
        }
    }

    protected function permissions(): array
    {
        return [
            'web_orders.view' => 'View online store orders',
            'web_orders.manage' => 'Process online store orders: confirm payments, ship, deliver, record cash on delivery, cancel',
            'web_orders.remit' => 'Record and view couriers\' cash-on-delivery remittances',
            'web_orders.refund' => 'Handle online returns of web orders (create, approve, reject, receive, refund) and cancel paid orders with a refund',
        ];
    }
}
