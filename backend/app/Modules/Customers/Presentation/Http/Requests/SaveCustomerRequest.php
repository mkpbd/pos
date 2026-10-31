<?php

namespace App\Modules\Customers\Presentation\Http\Requests;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Cashiers (customers.create) can register a customer quickly at the till; commercial
 * terms — group, credit limit, opening balance — need customers.manage.
 */
class SaveCustomerRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';
        $ignore = $this->route('customer')?->id;
        $managed = $this->user()?->can('customers.manage') ? 'sometimes' : 'prohibited';

        return [
            'code' => ['sometimes', 'nullable', 'string', 'max:30', 'regex:/^[A-Za-z0-9\-_.]+$/', new TenantUnique('customers', 'code', $ignore, softDeletes: true)],
            'name' => [$required, 'string', 'max:255'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32', 'regex:/^\+?[0-9 ()\-]{5,32}$/', new TenantUnique('customers', 'phone', $ignore, softDeletes: true)],
            'email' => ['sometimes', 'nullable', 'email:rfc', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'tax_number' => ['sometimes', 'nullable', 'string', 'max:64'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'customer_group_id' => [$managed, 'nullable', 'uuid', Rule::exists('customer_groups', 'id')->where('organization_id', app(TenantContext::class)->organizationId())],
            'credit_limit' => [$managed, 'decimal:0,2', 'min:0', 'max:9999999999999999'],
            'opening_balance' => [$managed, 'decimal:0,2', 'min:-9999999999999999', 'max:9999999999999999'],
            'is_active' => [$managed, 'boolean'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $this->merge(array_filter([
            'code' => is_string($this->input('code')) ? mb_strtoupper(trim($this->input('code'))) : null,
            // Store phones without spaces/dashes so the cashier's lookup matches however it was typed.
            'phone' => is_string($this->input('phone')) && trim($this->input('phone')) !== ''
                ? preg_replace('/[\s()\-]/', '', $this->input('phone'))
                : null,
        ], fn ($v) => $v !== null));
    }
}
