<?php

namespace App\Modules\Organizations\Presentation\Http\Requests;

use App\Modules\Organizations\Domain\Enums\TaxMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Shared by public sign-up and platform-admin provisioning.
 */
class ProvisionOrganizationRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'organization_name' => ['required', 'string', 'max:255'],
            'branch_name' => ['sometimes', 'string', 'max:255'],
            'currency' => ['sometimes', 'string', 'size:3', 'regex:/^[A-Z]{3}$/'],
            'timezone' => ['sometimes', 'timezone:all'],
            'tax_mode' => ['sometimes', Rule::enum(TaxMode::class)],
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email:rfc', 'max:255', Rule::unique('users', 'email')],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge(array_filter([
            'email' => is_string($this->input('email')) ? mb_strtolower(trim($this->input('email'))) : null,
            'currency' => is_string($this->input('currency')) ? mb_strtoupper($this->input('currency')) : null,
        ]));
    }
}
