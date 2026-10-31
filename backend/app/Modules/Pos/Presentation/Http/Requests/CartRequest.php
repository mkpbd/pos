<?php

namespace App\Modules\Pos\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * A POS cart: products and quantities with optional discounts. Prices, taxes and totals are
 * never accepted from the client — the server prices every cart.
 *
 * Leave `invoice_discount` out to apply the customer's group discount automatically;
 * send `null` for no invoice discount.
 */
class CartRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'customer_id' => ['nullable', 'uuid'],
            'lines' => ['required', 'array', 'min:1', 'max:200'],
            'lines.*.variant_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'regex:/^\d{1,12}(\.\d{1,3})?$/', 'not_regex:/^0+(\.0+)?$/'],
            ...$this->discountRules('lines.*.discount'),
            ...$this->discountRules('invoice_discount', ['sometimes']),
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function messages(): array
    {
        return [
            'lines.*.quantity.regex' => 'Enter a quantity with up to 3 decimals.',
            'lines.*.quantity.not_regex' => 'The quantity must be greater than zero.',
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator) {
            $check = function (string $path, mixed $discount) use ($validator) {
                if (is_array($discount) && ($discount['type'] ?? null) === 'percent' && is_numeric($discount['value'] ?? null) && $discount['value'] > 100) {
                    $validator->errors()->add("{$path}.value", 'A percentage discount cannot exceed 100%.');
                }
            };
            foreach ((array) $this->input('lines', []) as $i => $line) {
                $check("lines.{$i}.discount", is_array($line) ? ($line['discount'] ?? null) : null);
            }
            $check('invoice_discount', $this->input('invoice_discount'));
        }];
    }

    /**
     * @param  list<string>  $presence
     * @return array<string, list<mixed>>
     */
    protected function discountRules(string $field, array $presence = []): array
    {
        return [
            $field => [...$presence, 'nullable', 'array:type,value'],
            "{$field}.type" => ["required_with:{$field}", Rule::in(['percent', 'amount'])],
            "{$field}.value" => ["required_with:{$field}", 'decimal:0,2', 'min:0', 'max:9999999999999'],
        ];
    }
}
