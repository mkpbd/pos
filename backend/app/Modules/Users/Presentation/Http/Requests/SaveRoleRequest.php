<?php

namespace App\Modules\Users\Presentation\Http\Requests;

use App\Modules\Shared\Application\Authorization\PermissionRegistry;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveRoleRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => [
                'required', 'string', 'max:100',
                Rule::unique('roles', 'name')
                    ->where('organization_id', app(TenantContext::class)->organizationId())
                    ->ignore($this->route('role')),
            ],
            'description' => ['nullable', 'string', 'max:255'],
            'permissions' => ['present', 'array'],
            'permissions.*' => ['string', 'distinct', Rule::in(array_keys(app(PermissionRegistry::class)->all()))],
        ];
    }
}
