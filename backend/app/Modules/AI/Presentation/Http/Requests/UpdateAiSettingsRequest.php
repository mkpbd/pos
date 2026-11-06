<?php

namespace App\Modules\AI\Presentation\Http\Requests;

use App\Modules\AI\Application\Services\AiSettingsService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateAiSettingsRequest extends FormRequest
{
    public const MAX_BUDGET = 10_000_000_000;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'enabled' => ['sometimes', 'boolean'],
            // null = the application default; 0 = unlimited.
            'monthly_token_budget' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:'.self::MAX_BUDGET],
            'data_sharing_level' => ['sometimes', Rule::in(AiSettingsService::SHARING_LEVELS)],
        ];
    }
}
