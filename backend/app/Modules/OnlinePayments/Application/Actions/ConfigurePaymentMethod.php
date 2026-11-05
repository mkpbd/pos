<?php

namespace App\Modules\OnlinePayments\Application\Actions;

use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\OnlinePayments\Infrastructure\Models\PaymentGatewaySetting;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\TranslationInput;
use Illuminate\Support\Facades\DB;

/**
 * Saves an organization's configuration of a payment method, creating the row from the
 * defaults on first use. Settings are merged over the stored ones.
 */
class ConfigurePaymentMethod
{
    private const AUDITED = ['is_enabled', 'display_name', 'instructions', 'settings', 'sort_order', 'translations'];

    /** E12b: translatable texts with the limits of their base fields (plain text). */
    public const TRANSLATABLE = ['display_name' => ['max:60'], 'instructions' => ['max:2000']];

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * Rows of every method, created with defaults where missing.
     */
    public function ensureRows(): void
    {
        foreach (GatewayCode::cases() as $code) {
            PaymentGatewaySetting::query()->firstOrCreate(['code' => $code->value], $code->defaults());
        }
    }

    /**
     * @param  array{is_enabled?: bool, display_name?: string, instructions?: ?string, settings?: array<string, mixed>, sort_order?: int}  $data
     */
    public function __invoke(GatewayCode $code, array $data): PaymentGatewaySetting
    {
        return DB::transaction(function () use ($code, $data) {
            /** @var PaymentGatewaySetting $row */
            $row = PaymentGatewaySetting::query()->lockForUpdate()->firstOrCreate(['code' => $code->value], $code->defaults());
            $before = $row->only(self::AUDITED);

            if (array_key_exists('settings', $data)) {
                $data['settings'] = array_intersect_key($data['settings'] + ($row->settings ?? []), $code->defaults()['settings']);
            }
            if (array_key_exists('translations', $data)) {
                $data['translations'] = TranslationInput::apply($row->translations, $data['translations'], array_keys(self::TRANSLATABLE));
            }
            $row->fill(array_intersect_key($data, array_flip(self::AUDITED)))->save();

            [$old, $new] = Changes::between($before, $row->only(self::AUDITED));
            if ($new !== []) {
                $this->audit->record('payment_gateway.updated', $row, $old, $new, ['code' => $code->value]);
            }

            return $row;
        });
    }
}
