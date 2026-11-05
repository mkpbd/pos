<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Application\Actions\SaveBrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Slug;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

class SaveBrandListingRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        if (is_string($this->input('slug'))) {
            $this->merge(['slug' => mb_strtolower(trim($this->input('slug')))]);
        }
    }

    public function rules(): array
    {
        $listingId = BrandListing::query()->where('brand_id', (string) $this->route('brandId'))->value('id');

        return [
            'slug' => ['sometimes', 'nullable', 'string', 'max:120', 'regex:'.Slug::PATTERN,
                (new TenantUnique('brand_listings', 'slug', $listingId))->withMessage('Another brand already uses this address.')],
            'is_visible' => ['required', 'boolean'],
            'logo_media_id' => ['sometimes', 'nullable', 'uuid'],
            'description' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'seo_title' => ['sometimes', 'nullable', 'string', 'max:70'],
            'seo_description' => ['sometimes', 'nullable', 'string', 'max:160'],
            // E12b: {bn: {name, description, seo_title, seo_description}}.
            ...TranslationInput::rules(SaveBrandListing::TRANSLATABLE),
        ];
    }

    public function messages(): array
    {
        return ['slug.regex' => 'Use lower-case letters, digits and single hyphens only.'];
    }
}
