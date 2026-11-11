<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The whole draft of a builder document with the revision it was edited from. The content's
 * structure is validated by the builder schema (422 DOCUMENT_INVALID with node paths).
 */
class SaveBuilderDraftRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'revision' => ['required', 'integer', 'min:0'],
            'content' => ['required', 'array'],
        ];
    }
}
