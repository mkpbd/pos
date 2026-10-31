<?php

namespace App\Modules\Catalog\Presentation\Http\Requests;

use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class SaveCategoryRequest extends FormRequest
{
    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';
        /** @var Category|null $category */
        $category = $this->route('category');
        $parentId = $this->has('parent_id') ? $this->input('parent_id') : $category?->parent_id;

        return [
            // Names are unique among siblings only ("Accessories" may exist under several parents).
            'name' => [$required, 'string', 'max:100', (new TenantUnique('categories', 'name', $category?->id))->where('parent_id', $parentId)],
            'parent_id' => ['sometimes', 'nullable', 'uuid'],
            'description' => ['sometimes', 'nullable', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:65535'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            $parentId = $this->input('parent_id');
            if (is_string($parentId) && ! Category::query()->whereKey($parentId)->exists()) {
                $validator->errors()->add('parent_id', 'The selected parent category does not exist.');
            }
        }];
    }
}
