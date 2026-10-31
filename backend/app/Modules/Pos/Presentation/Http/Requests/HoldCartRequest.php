<?php

namespace App\Modules\Pos\Presentation\Http\Requests;

/**
 * Parks a cart to serve the next customer; it is priced again when resumed.
 */
class HoldCartRequest extends CartRequest
{
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'label' => ['nullable', 'string', 'max:100'],
            'lines.*.serials' => ['sometimes', 'array', 'max:1000'],
            'lines.*.serials.*' => ['string', 'max:100'],
        ];
    }
}
