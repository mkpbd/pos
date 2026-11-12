<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * B5: "save section as template" — `{name, description?, scope: "section", context, section}`.
 * The section itself is validated by the builder schema in the action.
 */
class SaveBuilderTemplateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:300'],
            'scope' => ['required', Rule::in(['section'])],
            'context' => ['required', Rule::in(ElementRegistry::CONTEXTS)],
            'section' => ['required', 'array'],
        ];
    }
}
