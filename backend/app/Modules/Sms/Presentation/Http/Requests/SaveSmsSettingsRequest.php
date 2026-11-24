<?php

namespace App\Modules\Sms\Presentation\Http\Requests;

use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Gateways\HostGuard;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveSmsSettingsRequest extends FormRequest
{
    private const PARAM = 'regex:/^[A-Za-z0-9_.\-\[\]]{1,40}$/';

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $rules = [
            'is_enabled' => ['sometimes', 'boolean'],
            'driver' => ['sometimes', Rule::in(['log', 'http'])],
            'http_url' => ['sometimes', 'nullable', 'string', 'max:500', 'url', function (string $attribute, mixed $value, Closure $fail) {
                $scheme = strtolower((string) parse_url((string) $value, PHP_URL_SCHEME));
                if (is_string($value) && trim($value) !== '' && ! HostGuard::schemeAllowed($scheme)) {
                    $fail('The gateway address must start with https://.');
                }
            }],
            'http_method' => ['sometimes', Rule::in(['GET', 'POST'])],
            'http_body' => ['sometimes', Rule::in(['form', 'json'])],
            'param_to' => ['sometimes', 'string', self::PARAM],
            'param_message' => ['sometimes', 'string', self::PARAM],
            'param_sender' => ['sometimes', 'nullable', 'string', self::PARAM],
            'param_api_key' => ['sometimes', 'nullable', 'string', self::PARAM],
            'api_key' => ['sometimes', 'nullable', 'string', 'max:500'],
            'sender_id' => ['sometimes', 'nullable', 'string', 'max:20'],
            'extra_params' => ['sometimes', 'nullable', 'array', 'max:10', function (string $attribute, mixed $value, Closure $fail) {
                if (! is_array($value)) {
                    return;
                }
                foreach ($value as $name => $param) {
                    if (! is_string($name) || preg_match('/^[A-Za-z0-9_.\-\[\]]{1,40}$/', $name) !== 1) {
                        $fail('Parameter names may use letters, digits and _ . - [ ] (up to 40).');

                        return;
                    }
                    if (! is_string($param) && ! is_int($param) && ! is_float($param) || mb_strlen((string) $param) > 200) {
                        $fail('Each extra parameter value is a text of up to 200 characters.');

                        return;
                    }
                }
            }],
            'success_contains' => ['sometimes', 'nullable', 'string', 'max:100'],
            'phone_format' => ['sometimes', Rule::in(['local', '880', 'plus880'])],
            'monthly_limit' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000000'],
            'templates' => ['sometimes', 'array:'.implode(',', array_keys(SmsTemplate::ENABLED_BY_DEFAULT))],
        ];
        foreach (array_keys(SmsTemplate::ENABLED_BY_DEFAULT) as $event) {
            $rules["templates.{$event}"] = ['sometimes', 'array:enabled,en,bn'];
            $rules["templates.{$event}.enabled"] = ['sometimes', 'boolean'];
            $rules["templates.{$event}.en"] = ['sometimes', 'nullable', 'string', 'max:'.SmsTemplate::MAX_LENGTH];
            $rules["templates.{$event}.bn"] = ['sometimes', 'nullable', 'string', 'max:'.SmsTemplate::MAX_LENGTH];
        }

        return $rules;
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'param_to.regex' => 'Parameter names may use letters, digits and _ . - [ ] (up to 40).',
            'param_message.regex' => 'Parameter names may use letters, digits and _ . - [ ] (up to 40).',
            'param_sender.regex' => 'Parameter names may use letters, digits and _ . - [ ] (up to 40).',
            'param_api_key.regex' => 'Parameter names may use letters, digits and _ . - [ ] (up to 40).',
        ];
    }
}
