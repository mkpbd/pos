<?php

namespace App\Modules\Pos\Presentation\Http\Requests;

use App\Modules\Sales\Domain\PaymentMethod;
use Illuminate\Validation\Rule;

/**
 * Checkout = a cart plus the payments taken. Payments may be split over methods, may fall
 * short of the total (the rest stays due on a customer's account) and cash may exceed it
 * (change). Serial-tracked products need one serial number per unit.
 */
class CheckoutRequest extends CartRequest
{
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'lines.*.serials' => ['sometimes', 'array', 'max:1000'],
            'lines.*.serials.*' => ['string', 'max:100'],
            'payments' => ['present', 'array', 'max:10'],
            'payments.*.method' => ['required', Rule::enum(PaymentMethod::class)],
            'payments.*.amount' => ['required', 'decimal:0,2', 'gt:0', 'max:9999999999999'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],
            'held_sale_id' => ['nullable', 'uuid'],
        ];
    }
}
