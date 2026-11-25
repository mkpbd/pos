<?php

namespace App\Modules\Pos\Presentation\Http\Requests;

/**
 * POS1c: an exchange at the till — the return half (`return`: lines of an earlier invoice of
 * this branch), the new sale as a checkout cart with its payments (may be empty), `refunds` of
 * what the returned value leaves over, and a manager's `approval_id` for action `return` when
 * the cashier cannot approve returns. `customer_id` left out = the invoice's customer.
 */
class ExchangeRequest extends CheckoutRequest
{
    public function rules(): array
    {
        $rules = parent::rules();
        unset($rules['held_sale_id']);

        return [
            ...$rules,
            'return' => ['required', 'array'],
            'return.sale_id' => ['required', 'uuid'],
            'return.return_reason_id' => ['sometimes', 'nullable', 'uuid'],
            'return.notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'return.lines' => ['required', 'array', 'min:1', 'max:200'],
            'return.lines.*.sale_line_id' => ['required', 'uuid'],
            'return.lines.*.quantity' => ['required', 'decimal:0,3', 'gt:0'],
            'return.lines.*.restock' => ['sometimes', 'boolean'],
            'return.lines.*.serials' => ['sometimes', 'nullable', 'array', 'max:1000'],
            'return.lines.*.serials.*' => ['string', 'max:100'],
            'approval_id' => ['sometimes', 'nullable', 'uuid'],
            // The returned value left after paying the new sale (`exchange` is never accepted here).
            'refunds' => ['sometimes', 'array', 'max:10'],
            'refunds.*.method' => ['required', 'string', 'max:20', 'not_in:exchange'],
            'refunds.*.amount' => ['required', 'decimal:0,2', 'gt:0'],
            'refunds.*.reference' => ['sometimes', 'nullable', 'string', 'max:100'],
        ];
    }

    public function messages(): array
    {
        return [
            ...parent::messages(),
            'refunds.*.method.not_in' => 'The returned value pays the new sale by itself; refund the rest in cash or the way it was paid.',
        ];
    }
}
