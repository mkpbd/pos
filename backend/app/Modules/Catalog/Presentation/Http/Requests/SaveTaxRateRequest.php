<?php

namespace App\Modules\Catalog\Presentation\Http\Requests;

use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class SaveTaxRateRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:100', new TenantUnique('tax_rates', 'name', $this->route('taxRate')?->id)],
            'rate' => [$required, 'decimal:0,4', 'min:0', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
