<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * B3: the theme draft — the whole theme document (validated like `PUT /storefront/theme`) with
 * the draft revision it was edited from.
 */
class SaveThemeDraftRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'revision' => ['required', 'integer', 'min:0'],
            'settings' => ['present', 'array'],
            ...SaveThemeRequest::themeRules('settings.'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function settings(): array
    {
        return (array) $this->validated('settings', []);
    }
}
