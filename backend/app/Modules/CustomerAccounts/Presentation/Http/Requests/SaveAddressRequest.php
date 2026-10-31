<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * POST: every field except label, postcode and the default flags is required.
 * PATCH: any subset.
 */
class SaveAddressRequest extends FormRequest
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
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'label' => ['sometimes', 'nullable', 'string', 'max:40'],
            'recipient_name' => [$required, 'string', 'max:120'],
            'phone' => [$required, ...$this->mobileRule()],
            'division_id' => [$required, 'integer', 'exists:geo_divisions,id'],
            'district_id' => [$required, 'integer', 'exists:geo_districts,id'],
            'area' => [$required, 'string', 'max:100'],
            'address_line' => [$required, 'string', 'max:255'],
            'postcode' => ['sometimes', 'nullable', 'string', 'regex:/^\d{4}$/'],
            'is_default_shipping' => ['sometimes', 'boolean'],
            'is_default_billing' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function addressData(): array
    {
        $data = $this->validated();
        foreach (['division_id', 'district_id'] as $key) {
            if (isset($data[$key])) {
                $data[$key] = (int) $data[$key];
            }
        }
        foreach (['is_default_shipping', 'is_default_billing'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = $this->boolean($key);
            }
        }

        return $data;
    }
}
