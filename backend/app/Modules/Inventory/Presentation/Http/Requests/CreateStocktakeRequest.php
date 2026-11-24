<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use App\Modules\Inventory\Domain\StocktakeScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CreateStocktakeRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'scope' => ['required', Rule::enum(StocktakeScope::class)],
            // Category ids (sub-categories included) or product ids; required unless the scope is "all".
            'scope_ids' => ['exclude_if:scope,all', 'required_unless:scope,all', 'array', 'min:1', 'max:500'],
            'scope_ids.*' => ['uuid'],
            'blind' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
