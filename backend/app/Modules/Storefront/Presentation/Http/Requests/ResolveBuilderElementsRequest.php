<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The envelope of a canvas resolve request (B2): up to 60 elements with distinct node ids and
 * up to 200 media ids. Only the envelope is validated here (422 VALIDATION_FAILED); each
 * element's content is checked on its own by the builder schema and reported per element.
 */
class ResolveBuilderElementsRequest extends FormRequest
{
    public const MAX_ELEMENTS = 60;

    public const MAX_MEDIA = 200;

    public function rules(): array
    {
        return [
            'elements' => ['sometimes', 'array', 'list', 'max:'.self::MAX_ELEMENTS],
            'elements.*' => ['array'],
            'elements.*.id' => ['required', 'string', 'regex:/'.BuilderDocumentSchema::ID_PATTERN.'/', 'distinct'],
            'elements.*.type' => ['required', 'string', 'max:40'],
            'media_ids' => ['sometimes', 'array', 'list', 'max:'.self::MAX_MEDIA],
            'media_ids.*' => ['uuid'],
            'locale' => ['sometimes', 'nullable', 'string', 'max:10'],
        ];
    }

    public function messages(): array
    {
        return [
            'elements.*.id.regex' => 'Element ids are lower-case letters, digits, dashes and underscores, starting with a letter.',
        ];
    }

    /**
     * The elements as sent (their content is validated per element later).
     *
     * @return list<array<string, mixed>>
     */
    public function elements(): array
    {
        return array_values((array) $this->input('elements', []));
    }

    /**
     * @return list<string>
     */
    public function mediaIds(): array
    {
        return array_values((array) $this->validated('media_ids', []));
    }
}
