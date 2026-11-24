<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use App\Modules\Inventory\Domain\UncountedPolicy;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class PostStocktakeRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'uncounted_policy' => ['required', Rule::enum(UncountedPolicy::class)],
        ];
    }
}
