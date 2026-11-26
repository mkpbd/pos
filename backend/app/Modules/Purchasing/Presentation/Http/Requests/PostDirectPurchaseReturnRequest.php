<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

/**
 * ST2a: a purchase return without a goods receipt.
 */
class PostDirectPurchaseReturnRequest extends PostPurchaseReturnRequest
{
    public function rules(): array
    {
        return [
            'supplier_id' => ['required', 'uuid'],
            'store_id' => ['required', 'uuid'],
            ...array_diff_key(parent::rules(), ['lines.*.goods_receipt_line_id' => true]),
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.batch_id' => ['nullable', 'uuid'],
            'lines.*.unit_cost' => ['nullable', 'decimal:0,4', 'min:0', 'max:99999999999999'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.quantity.regex' => 'Enter a positive quantity with up to 3 decimals.',
            'lines.*.quantity.not_regex' => 'Enter a quantity greater than zero.',
        ];
    }
}
