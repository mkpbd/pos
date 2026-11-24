<?php

namespace App\Modules\Marketing\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class SaveTrackingSettingsRequest extends FormRequest
{
    public const CODE_MAX = 20000;

    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        // Ids are compared trimmed and upper-cased (GA4 and TikTok ids are upper case).
        foreach (['meta_pixel_id', 'meta_test_event_code', 'ga4_measurement_id', 'tiktok_pixel_id'] as $key) {
            $value = $this->input($key);
            if (is_string($value)) {
                $value = trim($value);
                $this->merge([$key => in_array($key, ['ga4_measurement_id', 'tiktok_pixel_id'], true) ? strtoupper($value) : $value]);
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'meta_pixel_id' => ['sometimes', 'nullable', 'string', 'regex:/^\d{10,20}$/'],
            'meta_capi_enabled' => ['sometimes', 'boolean'],
            'meta_capi_token' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'meta_test_event_code' => ['sometimes', 'nullable', 'string', 'max:40', 'regex:/^[A-Za-z0-9_-]{1,40}$/'],
            'ga4_measurement_id' => ['sometimes', 'nullable', 'string', 'regex:/^G-[A-Z0-9]{4,20}$/'],
            'tiktok_pixel_id' => ['sometimes', 'nullable', 'string', 'regex:/^[A-Z0-9]{10,30}$/'],
            'head_code' => ['sometimes', 'nullable', 'string', 'max:'.self::CODE_MAX],
            'body_code' => ['sometimes', 'nullable', 'string', 'max:'.self::CODE_MAX],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'meta_pixel_id.regex' => 'The Meta pixel ID is a number of 10 to 20 digits (Events Manager → Data sources).',
            'meta_test_event_code.regex' => 'The test event code uses letters and digits only, e.g. TEST12345.',
            'ga4_measurement_id.regex' => 'The GA4 measurement ID looks like G-XXXXXXXXXX.',
            'tiktok_pixel_id.regex' => 'The TikTok pixel ID uses 10 to 30 capital letters and digits.',
            'head_code.max' => 'Paste at most 20,000 characters of code.',
            'body_code.max' => 'Paste at most 20,000 characters of code.',
        ];
    }
}
