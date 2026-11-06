<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SaveRfqRequest extends FormRequest
{
    public function rules(): array
    {
        $creating = $this->isMethod('post');

        return [
            'store_id' => [$creating ? 'required' : 'sometimes', 'nullable', 'uuid'],
            'title' => ['required', 'string', 'max:150'],
            'needed_by' => ['nullable', 'date_format:Y-m-d'],
            'reply_by' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'supplier_ids' => ['nullable', 'array', 'max:20'],
            'supplier_ids.*' => ['uuid', 'distinct'],
            'lines' => $creating ? ['required', 'array', 'min:1', 'max:200'] : ['sometimes', 'nullable', 'array', 'min:1', 'max:200'],
            'lines.*.variant_id' => ['required', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
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
