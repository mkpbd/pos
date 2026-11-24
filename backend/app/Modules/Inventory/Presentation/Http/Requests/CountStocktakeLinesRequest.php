<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CountStocktakeLinesRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.batch_id' => ['nullable', 'uuid'],
            'lines.*.counted_quantity' => ['required', 'decimal:0,3', 'min:0', 'max:999999999999999'],
            'lines.*.note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
