<?php

namespace App\Modules\Products\Presentation\Http\Requests;

use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Domain\ProductDefinitionRules;
use Illuminate\Foundation\Http\FormRequest;

/**
 * P1a: the variant grid (options and every variant row). Cross-row rules live in
 * SaveVariantGrid / SaveProduct.
 */
class SaveVariantGridRequest extends FormRequest
{
    public function rules(): array
    {
        $money = ['decimal:0,2', 'min:0', 'max:9999999999999999'];

        return [
            'options' => ['present', 'nullable', 'array', 'max:3'],
            'options.*.name' => ['required', 'string', 'max:50'],
            'options.*.values' => ['required', 'array', 'min:1', 'max:50'],
            'options.*.values.*' => ['required', 'string', 'max:50'],

            'variants' => ['required', 'array', 'min:1', 'max:'.ProductDefinitionRules::MAX_VARIANTS],
            'variants.*.id' => ['nullable', 'uuid'],
            'variants.*.sku' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9\-_.\/]+$/'],
            'variants.*.name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'variants.*.option_values' => ['array'],
            'variants.*.option_values.*' => ['string', 'max:50'],
            'variants.*.purchase_price' => ['sometimes', 'required', ...$money],
            'variants.*.selling_price' => ['required', ...$money],
            'variants.*.wholesale_price' => ['nullable', ...$money],
            'variants.*.compare_at_price' => ['sometimes', 'nullable', 'regex:/^\d{1,16}(\.\d{1,2})?$/'],
            'variants.*.reorder_level' => ['nullable', 'decimal:0,3', 'min:0', 'max:999999999999999'],
            'variants.*.barcodes' => ['array', 'max:10'],
            'variants.*.barcodes.*' => ['string', 'max:'.Barcode::MAX_LENGTH],
            'variants.*.is_active' => ['boolean'],
            'variants.*.opening_stock' => ['sometimes', 'nullable', 'regex:/^\d{1,15}(\.\d{1,3})?$/'],

            'stock_store_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    public function messages(): array
    {
        return [
            'variants.*.compare_at_price.regex' => 'Enter an amount such as 140 or 140.50.',
            'variants.*.opening_stock.regex' => 'Enter a quantity with up to 3 decimals.',
        ];
    }

    /**
     * Validated data with list order kept.
     *
     * @return array<string, mixed>
     */
    public function gridData(): array
    {
        $data = $this->validated();
        ksort($data['variants']);
        $data['variants'] = array_values($data['variants']);
        if (is_array($data['options'] ?? null)) {
            ksort($data['options']);
            $data['options'] = array_values($data['options']);
        }

        return $data;
    }
}
