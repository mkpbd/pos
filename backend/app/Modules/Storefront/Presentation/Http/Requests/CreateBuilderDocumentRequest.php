<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A new store builder document (B1: pages only). `key` is `home` or `landing:<slug>`
 * (2–60 lower-case letters, digits and dashes; `landing:home` is reserved). `from` is
 * `blank` (default) or `homepage` (convert the current homepage sections).
 */
class CreateBuilderDocumentRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'kind' => ['required', Rule::in(['page'])],
            'key' => ['required', 'string', 'regex:/^(home|landing:[a-z0-9-]{2,60})$/', Rule::notIn(['landing:home'])],
            'title' => ['required', 'string', 'max:160'],
            'from' => ['sometimes', 'nullable', Rule::in(['blank', 'homepage'])],
        ];
    }

    public function messages(): array
    {
        return [
            'key.regex' => 'The key is "home" or "landing:" followed by 2–60 lower-case letters, digits and dashes.',
            'key.not_in' => 'The address "home" is reserved for the home page.',
        ];
    }
}
