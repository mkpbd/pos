<?php

namespace App\Modules\Customers\Presentation\Http\Requests;

use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class SaveCustomerGroupRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:100', new TenantUnique('customer_groups', 'name', $this->route('customerGroup')?->id)],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'discount_percent' => ['sometimes', 'decimal:0,2', 'min:0', 'max:100'],
        ];
    }
}
