<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RecordQuoteRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'supplier_id' => ['required', 'uuid'],
            'status' => ['required', Rule::in(['received', 'declined'])],
            'valid_until' => ['nullable', 'date_format:Y-m-d'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required_if:status,received', 'nullable', 'array', 'max:200'],
            'lines.*.rfq_line_id' => ['required', 'uuid', 'distinct'],
            'lines.*.unit_price' => ['required', 'decimal:0,4', 'min:0', 'max:99999999999999'],
            'lines.*.quantity_offered' => ['nullable', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'lines.*.lead_time_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'lines.*.notes' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.required_if' => 'Enter a price for at least one line, or record the quote as declined.',
            'lines.*.rfq_line_id.distinct' => 'Each line may appear only once.',
            'lines.*.quantity_offered.regex' => 'Enter a positive quantity with up to 3 decimals.',
            'lines.*.quantity_offered.not_regex' => 'Enter a quantity greater than zero.',
        ];
    }
}
