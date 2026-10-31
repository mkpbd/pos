<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use App\Modules\Purchasing\Domain\PaymentMethod;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RecordSupplierPaymentRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'supplier_id' => ['required', 'uuid'],
            'branch_id' => ['nullable', 'uuid'],
            'amount' => ['required', 'decimal:0,2', 'gt:0', 'max:9999999999999999'],
            'method' => ['required', Rule::enum(PaymentMethod::class)],
            'reference' => ['nullable', 'string', 'max:100'],
            'paid_on' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
