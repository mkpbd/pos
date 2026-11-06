<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * SC3: a landed cost voucher draft (also the body of the preview).
 */
class SaveLandedCostVoucherRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'branch_id' => ['required', 'uuid'],
            'voucher_date' => ['required', 'date_format:Y-m-d'],
            'charge_supplier_id' => ['required', 'uuid'],
            'reference' => ['nullable', 'string', 'max:64'],
            'notes' => ['nullable', 'string', 'max:1000'],
            ...PostGoodsReceiptRequest::chargeRules('charges', required: true),
            'receipt_ids' => ['required', 'array', 'min:1', 'max:50'],
            'receipt_ids.*' => ['required', 'uuid', 'distinct'],
        ];
    }

    public function messages(): array
    {
        return [
            'charges.*.amount.regex' => 'Enter an amount with up to 2 decimals.',
            'charges.*.amount.not_regex' => 'Enter an amount greater than zero.',
            'charges.*.tax_amount.regex' => 'Enter a tax amount of zero or more with up to 2 decimals.',
            'receipt_ids.*.distinct' => 'This receipt is already on the voucher.',
        ];
    }
}
