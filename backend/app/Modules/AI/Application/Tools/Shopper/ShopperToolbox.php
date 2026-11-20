<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Contracts\CustomerOrderStatus;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * AI2b: the tools of one shopper's assistant turn — read-only, organization from the store
 * host (tenant context), texts in the request's language (LocaleContext). Every tool reads
 * through other modules' contracts and returns public data only:
 *
 * - search_products, get_product (live listings), store_policies (delivery, payment, returns,
 *   contact), search_help (active FAQ, visible pages), current_offers (live automatic
 *   promotions, never coupons) — for every shopper;
 * - my_orders, order_status — only for a signed-in shopper, bound to that customer (there is
 *   no customer parameter the model could change).
 */
class ShopperToolbox
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly StorefrontCatalog $catalog,
        private readonly ShippingRates $shipping,
        private readonly GeoDirectory $geo,
        private readonly CheckoutPaymentMethods $payments,
        private readonly StorefrontConfig $storefront,
        private readonly PageDirectory $pages,
        private readonly PageContent $content,
        private readonly PromotionShowcase $promotions,
        private readonly CustomerOrderStatus $orders,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * @return array<string, AiTool> keyed by tool name
     */
    public function forShopper(?string $customerId, ShopperFindings $findings): array
    {
        $organization = $this->organizations->summary($this->tenant->requireOrganization()) ?? [];
        $currency = (string) ($organization['base_currency'] ?? '');
        $timezone = (string) ($organization['timezone'] ?? config('app.timezone'));

        $tools = [
            SearchProductsTool::NAME => new SearchProductsTool($this->catalog, $findings, $currency),
            GetProductTool::NAME => new GetProductTool($this->catalog, $this->shipping, $this->payments, $findings, $currency),
            StorePoliciesTool::NAME => new StorePoliciesTool($this->shipping, $this->geo, $this->payments, $this->storefront, $this->pages, $this->locale, $findings, $currency),
            SearchHelpTool::NAME => new SearchHelpTool($this->content, $findings),
            CurrentOffersTool::NAME => new CurrentOffersTool($this->promotions, $this->catalog, $findings, $currency),
        ];
        if ($customerId !== null && $customerId !== '') {
            $tools[MyOrdersTool::NAME] = new MyOrdersTool($this->orders, $findings, $customerId, $timezone);
            $tools[OrderStatusTool::NAME] = new OrderStatusTool($this->orders, $findings, $customerId, $timezone);
        }

        return $tools;
    }
}
