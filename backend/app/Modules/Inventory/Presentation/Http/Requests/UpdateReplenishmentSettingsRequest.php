<?php

namespace App\Modules\Inventory\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateReplenishmentSettingsRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'source_store_id' => ['sometimes', 'nullable', 'uuid'],
            'coverage_days' => ['sometimes', 'integer', 'min:1', 'max:180'],
            'velocity_days' => ['sometimes', 'integer', 'min:7', 'max:180'],
            'safety_days' => ['sometimes', 'integer', 'min:0', 'max:60'],
        ];
    }
}
