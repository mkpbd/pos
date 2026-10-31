<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\Shared\Domain\Slug;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class SaveCategoryListingRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('slug'))) {
            $this->merge(['slug' => mb_strtolower(trim($this->input('slug')))]);
        }
    }

    public function rules(): array
    {
        $listingId = CategoryListing::query()->where('category_id', (string) $this->route('categoryId'))->value('id');

        return [
            'slug' => ['sometimes', 'nullable', 'string', 'max:120', 'regex:'.Slug::PATTERN,
                (new TenantUnique('category_listings', 'slug', $listingId))->withMessage('Another category already uses this address.')],
            'is_visible' => ['required', 'boolean'],
            'image_media_id' => ['sometimes', 'nullable', 'uuid'],
            'banner_media_id' => ['sometimes', 'nullable', 'uuid'],
            'description_html' => ['sometimes', 'nullable', 'string', 'max:50000'],
            'seo_title' => ['sometimes', 'nullable', 'string', 'max:70'],
            'seo_description' => ['sometimes', 'nullable', 'string', 'max:160'],
        ];
    }

    public function messages(): array
    {
        return ['slug.regex' => 'Use lower-case letters, digits and single hyphens only.'];
    }
}
