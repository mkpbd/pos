<?php

namespace App\Modules\Organizations\Presentation\Http\Requests;

use App\Modules\Organizations\Domain\Enums\TaxMode;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateOrganizationRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tax_number' => ['sometimes', 'nullable', 'string', 'max:64'],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'timezone' => ['sometimes', 'timezone:all'],
            'tax_mode' => ['sometimes', Rule::enum(TaxMode::class)],
            // Base currency is fixed at creation: changing it would corrupt historical amounts.
            'base_currency' => ['prohibited'],
            'settings' => ['sometimes', 'array:receipt_header,receipt_footer,invoice_prefix'],
            'settings.receipt_header' => ['nullable', 'string', 'max:500'],
            'settings.receipt_footer' => ['nullable', 'string', 'max:500'],
            'settings.invoice_prefix' => ['nullable', 'string', 'max:10', 'regex:/^[A-Z0-9\-]*$/'],
        ];
    }
}
