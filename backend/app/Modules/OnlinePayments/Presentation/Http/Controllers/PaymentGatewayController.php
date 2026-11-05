<?php

namespace App\Modules\OnlinePayments\Presentation\Http\Controllers;

use App\Modules\OnlinePayments\Application\Actions\ConfigurePaymentMethod;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * How shoppers may pay (E8a: cash on delivery and bank transfer). Needs `payment_gateways.manage`.
 */
class PaymentGatewayController
{
    /**
     * Payment methods
     *
     * Both offline methods `[{code, display_name, is_enabled, instructions, settings, sort_order}]`;
     * rows are created with defaults on first read (cash on delivery on, bank transfer off).
     * Settings: bank_transfer `{hold_hours}` (1–168), cod `{max_order_total}` (null = no limit).
     */
    public function index(ConfigurePaymentMethod $configure, CheckoutPaymentMethods $methods): JsonResponse
    {
        $configure->ensureRows();

        return ApiResponse::success($methods->all());
    }

    /**
     * Configure a payment method
     *
     * `code` is `cod` or `bank_transfer`. Instructions (≤ 2000 characters) are shown on the order
     * confirmation page and e-mail — put the bank account details there for bank transfers.
     */
    public function update(Request $request, string $code, ConfigurePaymentMethod $configure, CheckoutPaymentMethods $methods): JsonResponse
    {
        $gateway = GatewayCode::tryFrom($code) ?? throw new NotFoundHttpException;
        $data = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'display_name' => ['sometimes', 'required', 'string', 'max:60'],
            'instructions' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
            'settings' => ['sometimes', 'array'],
            // E12b: {bn: {display_name, instructions}} (partial; blank removes).
            ...TranslationInput::rules(ConfigurePaymentMethod::TRANSLATABLE),
            ...match ($gateway) {
                GatewayCode::BankTransfer => ['settings.hold_hours' => ['sometimes', 'integer', 'min:1', 'max:168']],
                GatewayCode::CashOnDelivery => ['settings.max_order_total' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:99999999', 'decimal:0,2']],
            },
        ]);
        if (array_key_exists('is_enabled', $data)) {
            $data['is_enabled'] = $request->boolean('is_enabled');
        }
        if (isset($data['display_name'])) {
            $data['display_name'] = trim($data['display_name']);
        }
        if (array_key_exists('instructions', $data) && is_string($data['instructions'])) {
            $data['instructions'] = trim($data['instructions']) === '' ? null : trim($data['instructions']);
        }
        if (isset($data['settings']['hold_hours'])) {
            $data['settings']['hold_hours'] = (int) $data['settings']['hold_hours'];
        }
        if (isset($data['settings']['max_order_total'])) {
            $data['settings']['max_order_total'] = Decimal::round((string) $data['settings']['max_order_total'], 2);
        }

        $configure($gateway, $data);
        $view = array_values(array_filter($methods->all(), fn (array $m) => $m['code'] === $gateway->value))[0];

        return ApiResponse::success($view);
    }
}
