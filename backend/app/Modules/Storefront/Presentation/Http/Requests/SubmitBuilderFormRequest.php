<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Foundation\Http\FormRequest;

/**
 * B8b: the envelope of a builder form submission (shape only; the answers are checked against
 * the published form by SubmitBuilderForm). Bodies over 32 KB are 413 PAYLOAD_TOO_LARGE.
 */
class SubmitBuilderFormRequest extends FormRequest
{
    public const MAX_BYTES = 32768;

    protected function prepareForValidation(): void
    {
        if (strlen((string) $this->getContent()) > self::MAX_BYTES) {
            throw new BusinessRuleViolation('PAYLOAD_TOO_LARGE', 'The form is too large to send (at most 32 KB).', ['max_bytes' => self::MAX_BYTES], 413);
        }
    }

    public function rules(): array
    {
        return [
            'values' => ['present'],
            'consent' => ['sometimes', 'nullable'],
            'website' => ['sometimes', 'nullable', 'string', 'max:255'],
            'page_path' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
