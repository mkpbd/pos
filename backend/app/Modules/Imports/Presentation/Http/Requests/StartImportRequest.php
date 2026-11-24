<?php

namespace App\Modules\Imports\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Multipart upload: `type`, `file` (.xlsx or .csv, at most pos.imports.max_file_kb) and optional
 * `options` — sent as fields (`options[update_existing]=0`) or as a JSON string.
 */
class StartImportRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'type' => ['required', 'string', 'max:40'],
            'file' => ['required', 'file', 'extensions:xlsx,csv', 'max:'.(int) config('pos.imports.max_file_kb', 10240)],
            'options' => ['sometimes', 'array'],
            'options.update_existing' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.extensions' => 'Upload an Excel workbook (.xlsx) or a CSV file (.csv).',
            'file.max' => 'The file may be at most '.((int) config('pos.imports.max_file_kb', 10240) / 1024).' MB.',
        ];
    }

    protected function prepareForValidation(): void
    {
        $options = $this->input('options');
        if (is_string($options)) {
            $decoded = json_decode($options, true);
            $options = is_array($decoded) ? $decoded : $options;
        }
        if (is_array($options) && array_key_exists('update_existing', $options) && is_string($options['update_existing'])) {
            $flag = filter_var($options['update_existing'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            $options['update_existing'] = $flag ?? $options['update_existing'];
        }
        if ($options !== null) {
            $this->merge(['options' => $options]);
        }
    }
}
