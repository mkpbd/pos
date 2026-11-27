<?php

namespace App\Modules\Products\Presentation\Http\Requests;

use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Domain\ProductDefinitionRules;
use App\Modules\Products\Domain\ProductType;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Shape of a full product definition (create and replace). Cross-field rules
 * (options vs. variants, SKU/barcode uniqueness) live in the domain/action.
 */
class SaveProductRequest extends FormRequest
{
    public function rules(): array
    {
        $money = ['required', 'decimal:0,2', 'min:0', 'max:9999999999999999'];

        return [
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'type' => ['required', Rule::enum(ProductType::class)],
            'category_id' => ['nullable', 'uuid'],
            'brand_id' => ['nullable', 'uuid'],
            'unit_id' => ['required', 'uuid'],
            'tax_rate_id' => ['nullable', 'uuid'],
            'track_stock' => ['boolean'],
            'track_batches' => ['boolean'],
            'track_serials' => ['boolean'],
            'max_discount_percent' => ['nullable', 'decimal:0,2', 'min:0', 'max:100'],
            // POS1a: the price is typed at the till.
            'open_price' => ['sometimes', 'boolean'],
            'is_active' => ['boolean'],

            'options' => ['nullable', 'array', 'max:3'],
            'options.*.name' => ['required', 'string', 'max:50'],
            'options.*.values' => ['required', 'array', 'min:1', 'max:50'],
            'options.*.values.*' => ['required', 'string', 'max:50'],

            'variants' => ['required', 'array', 'min:1', 'max:'.ProductDefinitionRules::MAX_VARIANTS],
            'variants.*.id' => ['nullable', 'uuid'],
            'variants.*.sku' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9\-_.\/]+$/'],
            'variants.*.name' => ['nullable', 'string', 'max:255'],
            'variants.*.option_values' => ['array'],
            'variants.*.option_values.*' => ['string', 'max:50'],
            'variants.*.purchase_price' => $money,
            'variants.*.selling_price' => $money,
            'variants.*.wholesale_price' => ['nullable', 'decimal:0,2', 'min:0', 'max:9999999999999999'],
            'variants.*.reorder_level' => ['nullable', 'decimal:0,3', 'min:0', 'max:999999999999999'],
            'variants.*.is_active' => ['boolean'],
            // BD2a: delivery weight in grams (null = not set); left out = kept.
            'variants.*.weight_grams' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000'],
            ...self::packAndPriceRules(),
        ];
    }

    /**
     * Barcodes (ST2c: a code, or `{barcode, units, pack_name}` for a pack), quantity breaks and
     * branch prices of each variant — shared with the variant grid. Lists left out are kept.
     *
     * @return array<string, mixed>
     */
    public static function packAndPriceRules(): array
    {
        $money = ['required', 'decimal:0,2', 'min:0', 'max:9999999999999999'];

        return [
            'variants.*.barcodes' => ['array', 'max:10'],
            'variants.*.barcodes.*' => [function (string $attribute, mixed $value, Closure $fail) {
                $code = is_array($value) ? ($value['barcode'] ?? null) : $value;
                if (! is_string($code) || $code === '' || mb_strlen($code) > Barcode::MAX_LENGTH) {
                    $fail('Enter a barcode of at most '.Barcode::MAX_LENGTH.' characters.');
                }
            }],
            'variants.*.barcodes.*.units' => ['sometimes', 'decimal:0,3', 'min:1', 'max:999999'],
            'variants.*.barcodes.*.pack_name' => ['sometimes', 'nullable', 'string', 'max:40'],
            'variants.*.price_tiers' => ['sometimes', 'nullable', 'array', 'max:20'],
            'variants.*.price_tiers.*.min_quantity' => ['required', 'decimal:0,3', 'gt:1', 'max:999999999999999'],
            'variants.*.price_tiers.*.price' => $money,
            'variants.*.branch_prices' => ['sometimes', 'nullable', 'array', 'max:200'],
            'variants.*.branch_prices.*.branch_id' => ['required', 'uuid'],
            'variants.*.branch_prices.*.price' => $money,
        ];
    }
}
