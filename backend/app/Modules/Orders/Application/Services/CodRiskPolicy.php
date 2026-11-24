<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Orders\Application\Queries\PhoneDeliveryReport;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * BD1b: cash-on-delivery fraud controls for orders shoppers place themselves (cart checkout
 * and landing-page order forms; never staff-entered orders):
 *
 * - a blocked mobile number (contact or delivery phone) cannot pay with cash on delivery —
 *   placement refuses it (422 COD_NOT_AVAILABLE) and the checkout previews report
 *   `cod_available: false`, treating COD as an unusable method (no COD fee, method null);
 * - the store's `cod_review` decides which COD orders wait for a confirmation call
 *   (`pending_confirmation`): `all`, or `risky` = the number's delivery success rate
 *   (PhoneDeliveryReport) is known and below `cod_review_min_success_rate`, or
 *   `cod_review_new_numbers` and no order to the number was ever delivered.
 */
class CodRiskPolicy
{
    public function __construct(
        private readonly StorefrontConfig $storefront,
        private readonly PhoneDeliveryReport $report,
    ) {}

    /**
     * @param  list<string|null>  $phones  contact and delivery phones (any form; invalid ones are ignored)
     */
    public function codAvailable(array $phones): bool
    {
        return ! $this->report->anyBlocked(self::normalized($phones));
    }

    /**
     * @param  list<string|null>  $phones
     *
     * @throws BusinessRuleViolation COD_NOT_AVAILABLE
     */
    public function ensureCodAvailable(array $phones): void
    {
        if (! $this->codAvailable($phones)) {
            throw new BusinessRuleViolation('COD_NOT_AVAILABLE', 'Cash on delivery is not available for this order. Please choose another payment method.');
        }
    }

    /**
     * Adds `cod_available` to a checkout preview; when false and the preview priced cash on
     * delivery, the method is dropped like any unusable one (payment_method null, no COD fee).
     *
     * @param  array<string, mixed>  $preview  CheckoutQuoter preview
     * @param  list<string|null>  $phones
     * @return array<string, mixed>
     */
    public function preview(array $preview, array $phones): array
    {
        $available = $this->codAvailable($phones);
        if (! $available && ($preview['payment_method'] ?? null) === 'cod') {
            $currency = (string) $preview['currency'];
            $preview['total'] = Money::of((string) $preview['total'], $currency)->minus(Money::of((string) $preview['cod_fee'], $currency))->amount();
            $preview['cod_fee'] = Money::zero($currency)->amount();
            $preview['payment_method'] = null;
        }

        return $preview + ['cod_available' => $available];
    }

    /**
     * Whether a shop cash-on-delivery order from this contact number waits for a call.
     */
    public function holdsForReview(string $phone): bool
    {
        $settings = $this->storefront->settings();
        $mode = $settings->cod_review ?? 'off';
        if ($mode === 'all') {
            return true;
        }
        if ($mode !== 'risky') {
            return false;
        }
        $phone = BangladeshMobile::normalize($phone) ?? $phone;
        $history = $this->report->forPhone($phone);
        $minimum = (int) ($settings->cod_review_min_success_rate ?? 70);

        return ($history['success_rate'] !== null && $history['success_rate'] < $minimum)
            || ((bool) $settings->cod_review_new_numbers && $history['delivered'] === 0);
    }

    /**
     * @param  list<string|null>  $phones
     * @return list<string>
     */
    private static function normalized(array $phones): array
    {
        return array_values(array_unique(array_filter(array_map(fn ($p) => is_string($p) ? BangladeshMobile::normalize($p) : null, $phones))));
    }
}
