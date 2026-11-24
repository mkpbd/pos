<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ScanStocktakeRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'barcode' => ['required', 'string', 'max:128'],
            'quantity' => ['sometimes', 'decimal:0,3', 'gt:0', 'max:999999'],
            // After BATCH_REQUIRED: the batch the scanned item belongs to.
            'batch_id' => ['nullable', 'uuid'],
        ];
    }
}
