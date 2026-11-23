<?php

namespace App\Modules\Authentication\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * G1a: exactly one of a 6-digit authenticator `code` or a `recovery_code`.
 */
class TwoFactorChallengeRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'code' => ['nullable', 'string', 'digits:6', 'required_without:recovery_code', 'prohibits:recovery_code'],
            'recovery_code' => ['nullable', 'string', 'max:32', 'required_without:code'],
        ];
    }
}
