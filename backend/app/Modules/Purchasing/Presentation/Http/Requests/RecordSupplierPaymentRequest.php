<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use App\Modules\Organizations\Application\Support\OrganizationDate;
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
            // ST1: the payments ledger's methods ("other" is kept only on older payments).
            'method' => ['required', Rule::in(PaymentMethod::recordable())],
            'reference' => ['nullable', 'string', 'max:100'],
            'paid_on' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.app(OrganizationDate::class)->today()],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
