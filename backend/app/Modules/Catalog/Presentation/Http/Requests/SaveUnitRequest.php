<?php

namespace App\Modules\Catalog\Presentation\Http\Requests;

use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class SaveUnitRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';
        $ignore = $this->route('unit')?->id;

        return [
            'name' => [$required, 'string', 'max:50', new TenantUnique('units', 'name', $ignore)],
            'code' => [$required, 'string', 'max:20', 'regex:/^[\pL\pN.\-_\/]+$/u', new TenantUnique('units', 'code', $ignore)],
            'allow_decimal' => ['sometimes', 'boolean'],
            'base_unit_id' => ['sometimes', 'nullable', 'uuid'],
            'conversion_factor' => ['sometimes', 'nullable', 'decimal:0,6', 'gt:0', 'max:1000000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
