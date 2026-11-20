<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * AI2a: an AI drafts run — the chosen subjects (`ids`; more than 200 is BATCH_TOO_LARGE) or the
 * texts they lack (`missing`), plus what to write.
 */
class CreateAiDraftBatchRequest extends FormRequest
{
    public function rules(): array
    {
        return WriteCatalogTextsRequest::writingRules() + [
            'ids' => ['required_without:missing', 'prohibits:missing', 'array', 'list', 'min:1', 'max:1000'],
            'ids.*' => ['required', 'uuid'],
            'missing' => ['required_without:ids', 'array', 'list', 'min:1', 'max:3'],
            'missing.*' => ['required', 'distinct', Rule::in(['description', 'seo', 'bangla'])],
        ];
    }
}
