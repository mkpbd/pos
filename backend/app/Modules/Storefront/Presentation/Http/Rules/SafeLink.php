<?php

namespace App\Modules\Storefront\Presentation\Http\Rules;

use App\Modules\Storefront\Domain\LinkTarget;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

class SafeLink implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value) || ! LinkTarget::isSafe($value)) {
            $fail('The :attribute must be a site path such as /sale or an http(s) URL.');
        }
    }
}
