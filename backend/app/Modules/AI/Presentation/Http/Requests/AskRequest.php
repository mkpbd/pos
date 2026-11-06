<?php

namespace App\Modules\AI\Presentation\Http\Requests;

use App\Modules\AI\Application\Assistants\AskAssistant;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AskRequest extends FormRequest
{
    public const MAX_QUESTION = 1000;

    public const MAX_TURN = 4000;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'question' => ['required', 'string', 'min:2', 'max:'.self::MAX_QUESTION],
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
            'history' => ['sometimes', 'array', 'max:'.AskAssistant::MAX_HISTORY],
            'history.*' => ['array:role,content'],
            'history.*.role' => ['required', Rule::in(['user', 'assistant'])],
            'history.*.content' => ['required', 'string', 'max:'.self::MAX_TURN],
        ];
    }
}
