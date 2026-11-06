<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class ConvertRequisitionRequest extends FormRequest
{
    public function rules(): array
    {
        $quantity = ['nullable', 'regex:/^\d{1,15}(\.\d{1,3})?$/'];

        return [
            'purchase_orders' => ['nullable', 'array'],
            'purchase_orders.lines' => ['required_with:purchase_orders', 'array', 'max:200'],
            'purchase_orders.lines.*.requisition_line_id' => ['required', 'uuid'],
            'purchase_orders.lines.*.quantity' => $quantity,
            'purchase_orders.lines.*.supplier_id' => ['nullable', 'uuid'],
            'rfq' => ['nullable', 'array'],
            'rfq.lines' => ['required_with:rfq', 'array', 'max:200'],
            'rfq.lines.*.requisition_line_id' => ['required', 'uuid'],
            'rfq.lines.*.quantity' => $quantity,
            'rfq.title' => ['nullable', 'string', 'max:150'],
            'rfq.reply_by' => ['nullable', 'date_format:Y-m-d'],
            'rfq.notes' => ['nullable', 'string', 'max:2000'],
            'rfq.supplier_ids' => ['nullable', 'array', 'max:20'],
            'rfq.supplier_ids.*' => ['uuid', 'distinct'],
        ];
    }

    public function messages(): array
    {
        return [
            'purchase_orders.lines.*.quantity.regex' => 'Enter a positive quantity with up to 3 decimals.',
            'rfq.lines.*.quantity.regex' => 'Enter a positive quantity with up to 3 decimals.',
        ];
    }
}
