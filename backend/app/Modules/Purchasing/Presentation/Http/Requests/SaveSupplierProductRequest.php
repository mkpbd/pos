<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST (create) and PATCH (update) of a supplier catalog row. Supplier and variant are fixed
 * once created; last purchase cost is never accepted (goods receipts write it).
 */
class SaveSupplierProductRequest extends FormRequest
{
    public function rules(): array
    {
        $creating = $this->isMethod('POST');
        $quantity = ['regex:/^\d{1,15}(\.\d{1,3})?$/'];

        return [
            'supplier_id' => $creating ? ['required', 'uuid'] : ['prohibited'],
            'variant_id' => $creating ? ['required', 'uuid'] : ['prohibited'],
            'supplier_sku' => ['sometimes', 'nullable', 'string', 'max:64'],
            'unit_cost' => [$creating ? 'required' : 'sometimes', 'decimal:0,4', 'min:0', 'max:99999999999999'],
            'pack_size' => ['sometimes', 'nullable', ...$quantity, 'not_regex:/^0*(\.\d*)?$/'],
            'min_order_qty' => ['sometimes', 'nullable', ...$quantity, 'not_regex:/^0+(\.0+)?$/'],
            'lead_time_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:365'],
            'is_preferred' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'last_purchase_cost' => ['prohibited'],
            'last_purchased_at' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'pack_size.regex' => 'Enter a pack size with up to 3 decimals.',
            'pack_size.not_regex' => 'The pack size must be at least 1.',
            'min_order_qty.regex' => 'Enter a quantity with up to 3 decimals.',
            'min_order_qty.not_regex' => 'Enter a minimum order greater than zero.',
            'last_purchase_cost.prohibited' => 'The last purchase cost is updated by goods receipts.',
            'last_purchased_at.prohibited' => 'The last purchase date is updated by goods receipts.',
        ];
    }
}
