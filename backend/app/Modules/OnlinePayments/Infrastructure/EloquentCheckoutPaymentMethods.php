<?php

namespace App\Modules\OnlinePayments\Infrastructure;

use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\OnlinePayments\Domain\GatewayInitiation;
use App\Modules\OnlinePayments\Domain\PaymentGateway;
use App\Modules\OnlinePayments\Infrastructure\Gateways\BankTransferGateway;
use App\Modules\OnlinePayments\Infrastructure\Gateways\CashOnDeliveryGateway;
use App\Modules\OnlinePayments\Infrastructure\Models\PaymentGatewaySetting;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

class EloquentCheckoutPaymentMethods implements CheckoutPaymentMethods
{
    /** E12b: display names and instructions in the request's language. */
    public function __construct(private readonly LocaleContext $locale) {}

    public function all(): array
    {
        $saved = PaymentGatewaySetting::query()->get()->keyBy('code');
        $methods = array_map(fn (GatewayCode $code) => self::config($code, $saved->get($code->value), $this->locale->current()), GatewayCode::cases());
        usort($methods, fn (array $a, array $b) => [$a['sort_order'], $a['code']] <=> [$b['sort_order'], $b['code']]);

        return $methods;
    }

    public function enabled(): array
    {
        return array_values(array_filter($this->all(), fn (array $m) => $m['is_enabled']));
    }

    public function usable(string $code, string $orderTotal, bool $deliveryAllowsCod): array
    {
        $method = null;
        foreach ($this->enabled() as $candidate) {
            if ($candidate['code'] === $code) {
                $method = $candidate;
            }
        }
        if ($method === null) {
            throw new BusinessRuleViolation('PAYMENT_METHOD_UNAVAILABLE', 'This payment method is not available. Choose another one.', ['payment_method' => $code, 'reason' => 'disabled']);
        }

        if ($code === GatewayCode::CashOnDelivery->value) {
            if (! $deliveryAllowsCod) {
                throw new BusinessRuleViolation('PAYMENT_METHOD_UNAVAILABLE', 'Cash on delivery is not available for this delivery method.', ['payment_method' => $code, 'reason' => 'delivery_method']);
            }
            $max = $method['settings']['max_order_total'] ?? null;
            if ($max !== null && Decimal::compare($orderTotal, (string) $max) > 0) {
                throw new BusinessRuleViolation('PAYMENT_METHOD_UNAVAILABLE', "Cash on delivery is available for orders up to {$max}.", ['payment_method' => $code, 'reason' => 'max_order_total', 'max_order_total' => Decimal::round((string) $max, 2)]);
            }
        }

        return $method;
    }

    public function initiate(string $code, array $order): GatewayInitiation
    {
        return $this->driver(GatewayCode::from($code))->initiate($order);
    }

    private function driver(GatewayCode $code): PaymentGateway
    {
        return match ($code) {
            GatewayCode::CashOnDelivery => new CashOnDeliveryGateway,
            GatewayCode::BankTransfer => new BankTransferGateway,
        };
    }

    /**
     * `display_name` and `instructions` in `$locale` (per-field fallback, E12b); `translations`
     * is the stored document ({bn: {display_name, instructions}}) for the admin.
     *
     * @return array{code: string, display_name: string, is_enabled: bool, instructions: ?string, settings: array<string, mixed>, sort_order: int, translations: array<string, mixed>}
     */
    public static function config(GatewayCode $code, ?PaymentGatewaySetting $row, string $locale = LocaleContext::BASE): array
    {
        $defaults = $code->defaults();

        return [
            'code' => $code->value,
            'display_name' => Translations::value($row?->translations, 'display_name', $locale, $row->display_name ?? $defaults['display_name']),
            'is_enabled' => $row?->is_enabled ?? $defaults['is_enabled'],
            'instructions' => Translations::value($row?->translations, 'instructions', $locale, $row === null ? $defaults['instructions'] : $row->instructions),
            'settings' => ($row?->settings ?? []) + $defaults['settings'],
            'sort_order' => $row->sort_order ?? $defaults['sort_order'],
            'translations' => TranslationInput::present($row?->translations),
        ];
    }
}
