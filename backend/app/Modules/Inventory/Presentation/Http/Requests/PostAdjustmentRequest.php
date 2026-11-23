<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use App\Modules\Inventory\Domain\AdjustmentReason;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PostAdjustmentRequest extends FormRequest
{
    public function rules(): array
    {
        $count = $this->input('reason') === AdjustmentReason::Count->value;

        return [
            'store_id' => ['required', 'uuid'],
            'reason' => ['required', Rule::enum(AdjustmentReason::class)],
            'note' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            // A stock count may list one product once per batch: the action checks product × batch.
            'lines.*.variant_id' => $count ? ['required', 'uuid'] : ['required', 'uuid', 'distinct:ignore_case'],
            // Signed: positive adds stock, negative removes it.
            'lines.*.quantity' => ['required_without:lines.*.counted_quantity', 'prohibits:lines.*.counted_quantity', 'nullable', 'regex:/^-?\d{1,15}(\.\d{1,3})?$/'],
            // Q1: a stock count may give the counted number instead; the server works out the difference.
            'lines.*.counted_quantity' => $count
                ? ['nullable', 'regex:/^\d{1,15}(\.\d{1,3})?$/']
                : ['prohibited'],
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
            'lines.*.quantity.required_without' => 'Enter a quantity.',
            'lines.*.quantity.prohibits' => 'Enter either the change or the counted quantity, not both.',
            'lines.*.counted_quantity.regex' => 'Enter the counted quantity: zero or more, with up to 3 decimals.',
            'lines.*.counted_quantity.prohibited' => 'A counted quantity is only for the "Stock count" reason.',
        ];
    }
}
