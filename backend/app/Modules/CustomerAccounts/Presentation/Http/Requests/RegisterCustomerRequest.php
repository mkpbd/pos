<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Requests;

use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class RegisterCustomerRequest extends FormRequest
{
    use NormalizesMobile;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email:rfc', 'max:254', new TenantUnique('customer_accounts', 'email')],
            'phone' => ['sometimes', 'nullable', ...$this->mobileRule()],
            'password' => ['required', 'string', 'confirmed', 'max:255', Password::defaults()],
        ];
    }
}
