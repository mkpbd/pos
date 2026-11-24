<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Requests;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class UpdateProfileRequest extends FormRequest
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
        $rules = [
            'name' => ['required', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', ...$this->mobileRule()],
        ];

        // BD1a: an account without an e-mail address may add one; otherwise the address is read-only (ignored).
        $account = $this->user('customer');
        if ($account instanceof CustomerAccount && $account->email === null) {
            $rules['email'] = ['sometimes', 'nullable', 'string', 'email:rfc', 'max:254', new TenantUnique('customer_accounts', 'email')];
        }

        return $rules;
    }
}
