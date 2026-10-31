<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use App\Modules\Inventory\Domain\AdjustmentReason;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PostAdjustmentRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'reason' => ['required', Rule::enum(AdjustmentReason::class)],
            'note' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.variant_id' => ['required', 'uuid', 'distinct:ignore_case'],
            // Signed: positive adds stock, negative removes it.
            'lines.*.quantity' => ['required', 'regex:/^-?\d{1,15}(\.\d{1,3})?$/'],
            'lines.*.unit_cost' => ['nullable', 'decimal:0,4', 'min:0', 'max:99999999999999'],
            'lines.*.batch_id' => ['nullable', 'uuid'],
            'lines.*.batch_number' => ['nullable', 'string', 'max:64'],
            'lines.*.expires_on' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.variant_id.distinct' => 'Each product may appear only once; combine the quantities.',
            'lines.*.quantity.regex' => 'Enter a quantity with up to 3 decimals.',
        ];
    }
}
