<?php

namespace App\Modules\Products\Presentation\Http\Requests;

use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Domain\ProductDefinitionRules;
use App\Modules\Products\Domain\ProductType;
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
            'variants.*.barcodes' => ['array', 'max:10'],
            'variants.*.barcodes.*' => ['string', 'max:'.Barcode::MAX_LENGTH],
            'variants.*.is_active' => ['boolean'],
        ];
    }
}
