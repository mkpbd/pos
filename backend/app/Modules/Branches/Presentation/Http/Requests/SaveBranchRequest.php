<?php

namespace App\Modules\Branches\Presentation\Http\Requests;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveBranchRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'code' => [
                $required, 'string', 'max:20', 'regex:/^[A-Za-z0-9\-_]+$/',
                Rule::unique('branches', 'code')
                    ->where('organization_id', app(TenantContext::class)->organizationId())
                    ->ignore($this->route('branch')),
            ],
            'name' => [$required, 'string', 'max:255'],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'timezone' => ['sometimes', 'nullable', 'timezone:all'],
            'allow_negative_stock' => ['sometimes', 'boolean'],
            'is_active' => [$this->isMethod('POST') ? 'prohibited' : 'sometimes', 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('code'))) {
            $this->merge(['code' => mb_strtoupper(trim($this->input('code')))]);
        }
    }
}
