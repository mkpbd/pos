<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PostGoodsReceiptRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'supplier_id' => ['required', 'uuid'],
            'store_id' => ['required', 'uuid'],
            'purchase_order_id' => ['nullable', 'uuid'],
            'supplier_invoice_number' => [
                'nullable', 'string', 'max:64',
                (new TenantUnique('goods_receipts', 'supplier_invoice_number'))
                    ->where('supplier_id', (string) $this->input('supplier_id'))
                    ->withMessage('This supplier invoice has already been recorded.'),
            ],
            'invoice_date' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'due_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:invoice_date'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.purchase_order_line_id' => [Rule::prohibitedIf(! $this->filled('purchase_order_id')), 'nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'lines.*.unit_cost' => ['required', 'decimal:0,4', 'min:0', 'max:99999999999999'],
            'lines.*.tax_rate' => ['nullable', 'decimal:0,4', 'min:0', 'max:100'],
            'lines.*.batch_number' => ['nullable', 'string', 'max:64'],
            'lines.*.expires_on' => ['nullable', 'date_format:Y-m-d'],
            'lines.*.manufactured_on' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:today'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.quantity.regex' => 'Enter a positive quantity with up to 3 decimals.',
            'lines.*.quantity.not_regex' => 'Enter a quantity greater than zero.',
            'lines.*.purchase_order_line_id.prohibited' => 'Order lines can only be referenced when receiving against a purchase order.',
        ];
    }
}
