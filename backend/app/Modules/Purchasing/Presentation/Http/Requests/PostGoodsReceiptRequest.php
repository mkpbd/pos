<?php

namespace App\Modules\Purchasing\Presentation\Http\Requests;

use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Domain\LandedCost\AllocationBasis;
use App\Modules\Purchasing\Domain\LandedCost\ChargeType;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PostGoodsReceiptRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'supplier_id' => ['required', 'uuid'],
            'store_id' => ['required', 'uuid'],
            'purchase_order_id' => ['nullable', 'uuid'],
            'supplier_invoice_number' => [
                'nullable', 'string', 'max:64',
                (new TenantUnique('goods_receipts', 'supplier_invoice_number'))
                    ->where('supplier_id', (string) $this->input('supplier_id'))
                    ->withMessage('This supplier invoice has already been recorded.'),
            ],
            'invoice_date' => ['required', 'date_format:Y-m-d', 'before_or_equal:'.app(OrganizationDate::class)->today()],
            'due_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:invoice_date'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.purchase_order_line_id' => [Rule::prohibitedIf(! $this->filled('purchase_order_id')), 'nullable', 'uuid'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,15}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            'lines.*.unit_cost' => ['required', 'decimal:0,4', 'min:0', 'max:99999999999999'],
            'lines.*.tax_rate' => ['nullable', 'decimal:0,4', 'min:0', 'max:100'],
            'lines.*.batch_number' => ['nullable', 'string', 'max:64'],
            'lines.*.expires_on' => ['nullable', 'date_format:Y-m-d'],
            'lines.*.manufactured_on' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.app(OrganizationDate::class)->today()],
            // SC3: landed cost charges, allocated over the lines.
            ...self::chargeRules('charges'),
            // Who bills the charge; empty = included in the main supplier's invoice.
            'charges.*.charge_supplier_id' => ['nullable', 'uuid'],
        ];
    }

    /**
     * Shared with landed cost vouchers.
     *
     * @return array<string, mixed>
     */
    public static function chargeRules(string $key, bool $required = false): array
    {
        return [
            $key => [$required ? 'required' : 'sometimes', 'array', ...($required ? ['min:1'] : []), 'max:20'],
            "{$key}.*.type" => ['required', Rule::enum(ChargeType::class)],
            "{$key}.*.description" => ['nullable', 'string', 'max:120'],
            "{$key}.*.amount" => ['required', 'regex:/^\d{1,15}(\.\d{1,2})?$/', 'not_regex:/^0+(\.0+)?$/'],
            "{$key}.*.tax_amount" => ['nullable', 'regex:/^\d{1,15}(\.\d{1,2})?$/'],
            "{$key}.*.allocation" => ['required', Rule::enum(AllocationBasis::class)],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.quantity.regex' => 'Enter a positive quantity with up to 3 decimals.',
            'lines.*.quantity.not_regex' => 'Enter a quantity greater than zero.',
            'lines.*.purchase_order_line_id.prohibited' => 'Order lines can only be referenced when receiving against a purchase order.',
            'charges.*.amount.regex' => 'Enter an amount with up to 2 decimals.',
            'charges.*.amount.not_regex' => 'Enter an amount greater than zero.',
            'charges.*.tax_amount.regex' => 'Enter a tax amount of zero or more with up to 2 decimals.',
        ];
    }
}
