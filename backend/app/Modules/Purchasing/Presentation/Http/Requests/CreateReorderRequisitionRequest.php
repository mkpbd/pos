<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Same body as POST /purchasing/reorder-suggestions/purchase-orders, but the unit cost and
 * the supplier are optional (SC2).
 */
class CreateReorderRequisitionRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'needed_by' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'submit' => ['sometimes', 'boolean'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.variant_id' => ['required', 'uuid', 'distinct'],
            'lines.*.supplier_id' => ['nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'lines.*.unit_cost' => ['nullable', 'decimal:0,4', 'min:0', 'max:99999999999999'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.variant_id.distinct' => 'Each product may appear only once.',
            'lines.*.quantity.regex' => 'Enter a positive quantity with up to 3 decimals.',
            'lines.*.quantity.not_regex' => 'Enter a quantity greater than zero.',
        ];
    }
}
