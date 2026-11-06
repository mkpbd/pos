<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class AwardRfqRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.rfq_line_id' => ['required', 'uuid'],
            'lines.*.supplier_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'update_catalog' => ['sometimes', 'boolean'],
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
