<?php

namespace App\Modules\Marketing\Application\Actions;

use App\Modules\Marketing\Application\Contracts\ConversionOrders;
use App\Modules\Marketing\Application\Contracts\ConversionsApi;
use App\Modules\Marketing\Application\Queries\TrackingConfig;
use App\Modules\Marketing\Domain\MetaConversionEvent;
use App\Modules\Shared\Application\Tenancy\TenantContext;

/**
 * BD1c: reports a placed shop or landing-page order to Meta's Conversions API as one `Purchase`
 * (MetaConversionEvent::purchase, `event_id` = the order number). Skipped (null) when the
 * Conversions API is not ready (off, or no pixel id or token), the order is gone or staff
 * entered it. The answer is stored as the settings' `capi_last_*` — except a retryable failure
 * that will be tried again (`$final` false). Runs in the order's organization.
 */
class SendMetaPurchase
{
    /** Orders shoppers placed themselves (never staff-entered ones). */
    public const SOURCES = ['storefront', 'landing_page'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly TrackingConfig $config,
        private readonly ConversionOrders $orders,
        private readonly ConversionsApi $api,
    ) {}

    /**
     * @return array{status: 'sent'|'failed', error: ?string, retryable: bool}|null
     */
    public function __invoke(string $organizationId, string $orderId, string $siteUrl, bool $final = true): ?array
    {
        return $this->tenant->runAs($organizationId, function () use ($organizationId, $orderId, $siteUrl, $final) {
            $settings = $this->config->settings($organizationId);
            if (! $settings->capiReady()) {
                return null;
            }
            $order = $this->orders->purchase($orderId);
            if ($order === null || ! in_array($order['source'], self::SOURCES, true)) {
                return null;
            }

            $path = $order['page_path'] ?? '/order/'.rawurlencode($order['number']);
            $event = MetaConversionEvent::purchase($order, rtrim($siteUrl, '/').$path);
            $result = $this->api->send((string) $settings->meta_pixel_id, (string) $settings->meta_capi_token, $event, $settings->meta_test_event_code);

            if ($result['status'] === 'sent' || ! $result['retryable'] || $final) {
                $this->config->recordResult($organizationId, $result['status'], $result['error']);
            }

            return $result;
        });
    }
}
