<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Requests;

use App\Modules\Shared\Domain\BangladeshMobile;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Rewrites a `phone` input to 01XXXXXXXXX (dropping +88, spaces and dashes) before
 * validation; anything that is not a Bangladeshi mobile number then fails MOBILE_RULE.
 *
 * @mixin FormRequest
 */
trait NormalizesMobile
{
    protected function prepareForValidation(): void
    {
        $phone = $this->input('phone');
        if (is_string($phone)) {
            $this->merge(['phone' => trim($phone) === '' ? null : (BangladeshMobile::normalize($phone) ?? $phone)]);
        }
    }

    /**
     * @return list<string>
     */
    protected function mobileRule(): array
    {
        return ['string', 'regex:'.BangladeshMobile::PATTERN];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return ['phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.'];
    }
}
