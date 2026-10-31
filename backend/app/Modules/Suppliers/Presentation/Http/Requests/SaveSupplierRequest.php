<?php

namespace App\Modules\Suppliers\Presentation\Http\Requests;

use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class SaveSupplierRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'code' => ['sometimes', 'nullable', 'string', 'max:30', 'regex:/^[A-Za-z0-9\-_.]+$/', new TenantUnique('suppliers', 'code', $this->route('supplier')?->id, softDeletes: true)],
            'name' => [$required, 'string', 'max:255'],
            'contact_person' => ['sometimes', 'nullable', 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'tax_number' => ['sometimes', 'nullable', 'string', 'max:64'],
            'payment_terms_days' => ['sometimes', 'integer', 'min:0', 'max:365'],
            'opening_balance' => ['sometimes', 'decimal:0,2', 'min:-9999999999999999', 'max:9999999999999999'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('code'))) {
            $this->merge(['code' => mb_strtoupper(trim($this->input('code')))]);
        }
    }
}
