<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SaveRequisitionRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'needed_by' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.variant_id' => ['required', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'lines.*.estimated_unit_cost' => ['nullable', 'decimal:0,4', 'min:0', 'max:99999999999999'],
            'lines.*.suggested_supplier_id' => ['nullable', 'uuid'],
            'lines.*.notes' => ['nullable', 'string', 'max:255'],
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
