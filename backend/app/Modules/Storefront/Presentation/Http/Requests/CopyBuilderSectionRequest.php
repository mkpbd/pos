<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Storefront\Application\Builder\CopyBuilderSection;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * B12: a section (or a global section reference) to copy into the drafts of up to 20 documents.
 * The section itself is validated in each target's context by the builder schema.
 */
class CopyBuilderSectionRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'section' => ['required', 'array'],
            'section.id' => ['required', 'string', 'max:32'],
            'section.type' => ['required', Rule::in(['section', BuilderDocumentSchema::GLOBAL_SECTION])],
            'document_ids' => ['required', 'array', 'min:1', 'max:'.CopyBuilderSection::MAX_DOCUMENTS],
            'document_ids.*' => ['required', 'uuid', 'distinct:ignore_case'],
            'position' => ['required', Rule::in(CopyBuilderSection::POSITIONS)],
        ];
    }

    /**
     * The whole section as sent (the schema validates and normalizes it per target).
     *
     * @return array<string, mixed>
     */
    public function section(): array
    {
        return (array) $this->input('section');
    }
}
