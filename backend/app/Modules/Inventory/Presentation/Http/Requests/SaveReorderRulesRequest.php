<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SaveReorderRulesRequest extends FormRequest
{
    public function rules(): array
    {
        $quantity = ['regex:/^\d{1,15}(\.\d{1,3})?$/'];

        return [
            'store_id' => ['required', 'uuid'],
            'rules' => ['required', 'array', 'min:1', 'max:500'],
            'rules.*.variant_id' => ['required', 'uuid', 'distinct'],
            'rules.*.min_qty' => ['required', ...$quantity],
            'rules.*.max_qty' => ['nullable', ...$quantity],
            'rules.*.is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'rules.*.variant_id.distinct' => 'Each product may appear only once.',
            'rules.*.min_qty.regex' => 'Enter a quantity of zero or more with up to 3 decimals.',
            'rules.*.max_qty.regex' => 'Enter a quantity of zero or more with up to 3 decimals.',
        ];
    }
}
