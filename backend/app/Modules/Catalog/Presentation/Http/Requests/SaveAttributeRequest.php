<?php

namespace App\Modules\Catalog\Presentation\Http\Requests;

use App\Modules\Catalog\Application\Actions\SaveAttribute;
use App\Modules\Catalog\Infrastructure\Models\Attribute;
use App\Modules\Shared\Domain\Slug;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class SaveAttributeRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('slug'))) {
            $this->merge(['slug' => mb_strtolower(trim($this->input('slug')))]);
        }
    }

    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';
        /** @var Attribute|null $attribute */
        $attribute = $this->route('attribute');

        return [
            'name' => [$required, 'string', 'max:60', new TenantUnique('attributes', 'name', $attribute?->id)],
            'slug' => ['sometimes', 'nullable', 'string', 'max:80', 'regex:'.Slug::PATTERN, (new TenantUnique('attributes', 'slug', $attribute?->id))->withMessage('This slug is already used by another attribute.')],
            'display' => [$required, Rule::in(Attribute::DISPLAYS)],
            'is_filterable' => [$required, 'boolean'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:65535'],
            'values' => [$this->isMethod('POST') ? 'present' : 'sometimes', 'array', 'max:'.SaveAttribute::MAX_VALUES],
            'values.*' => ['array'],
            'values.*.id' => ['sometimes', 'nullable', 'uuid', 'distinct'],
            'values.*.value' => ['required', 'string', 'max:60'],
            'values.*.swatch_hex' => ['sometimes', 'nullable', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
        ];
    }

    public function messages(): array
    {
        return ['slug.regex' => 'Use lower-case letters, digits and single hyphens only.'];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            $seen = [];
            foreach ((array) $this->input('values', []) as $i => $value) {
                $key = is_array($value) && is_string($value['value'] ?? null) ? mb_strtolower(trim($value['value'])) : null;
                if ($key === null) {
                    continue;
                }
                if (isset($seen[$key])) {
                    $validator->errors()->add("values.{$i}.value", 'Each value may appear only once.');
                }
                $seen[$key] = true;
            }
        }];
    }

    /**
     * The validated data with values in the order they were sent.
     *
     * @return array<string, mixed>
     */
    public function attributeData(): array
    {
        $data = $this->validated();
        if (isset($data['values'])) {
            ksort($data['values']);
            $data['values'] = array_values($data['values']);
        }

        return $data;
    }
}
