<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * AI2a: what the AI writer should write — the texts (fields) and languages, tone, length and
 * the staff's notes. Shared by "Write with AI" (one subject) and AI drafts (many).
 */
class WriteCatalogTextsRequest extends FormRequest
{
    /**
     * @return array<string, list<mixed>>
     */
    public static function writingRules(): array
    {
        return [
            'subject' => ['required', Rule::in(CatalogTextFields::SUBJECTS)],
            'fields' => ['required', 'array', 'list', 'min:1', 'max:'.count(CatalogTextFields::FIELDS)],
            'fields.*' => ['required', 'distinct', Rule::in(CatalogTextFields::FIELDS)],
            'languages' => ['required', 'array', 'list', 'min:1', 'max:'.count(CatalogTextFields::LANGUAGES)],
            'languages.*' => ['required', 'distinct', Rule::in(CatalogTextFields::LANGUAGES)],
            'tone' => ['sometimes', 'nullable', Rule::in(CatalogTextFields::TONES)],
            'length' => ['sometimes', 'nullable', Rule::in(CatalogTextFields::LENGTHS)],
            'notes' => ['sometimes', 'nullable', 'string', 'max:'.CatalogTextFields::NOTES_MAX],
        ];
    }

    public function rules(): array
    {
        return self::writingRules() + ['id' => ['required', 'uuid']];
    }
}
