<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\Shared\Domain\Slug;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A product's web listing. Omitted optional fields keep their stored value; `variants`
 * rows update only the variants they name.
 */
class SaveProductListingRequest extends FormRequest
{
    public const MAX_SPECIFICATIONS = 30;

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('slug'))) {
            $this->merge(['slug' => mb_strtolower(trim($this->input('slug')))]);
        }
    }

    public function rules(): array
    {
        $listingId = ProductListing::query()->where('product_id', (string) $this->route('productId'))->value('id');

        return [
            'slug' => ['sometimes', 'nullable', 'string', 'max:120', 'regex:'.Slug::PATTERN,
                (new TenantUnique('product_listings', 'slug', $listingId))->withMessage('Another product already uses this address.')],
            'is_published' => ['required', 'boolean'],
            'published_at' => ['sometimes', 'nullable', 'date'],
            'unpublished_at' => ['sometimes', 'nullable', 'date', ...($this->filled('published_at') ? ['after:published_at'] : [])],
            'is_featured' => ['required', 'boolean'],
            'is_new_until' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'short_description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'description_html' => ['sometimes', 'nullable', 'string', 'max:100000'],
            'specifications' => ['sometimes', 'nullable', 'array', 'max:'.self::MAX_SPECIFICATIONS],
            'specifications.*' => ['array'],
            'specifications.*.label' => ['required', 'string', 'max:60'],
            'specifications.*.value' => ['required', 'string', 'max:200'],
            'seo_title' => ['sometimes', 'nullable', 'string', 'max:70'],
            'seo_description' => ['sometimes', 'nullable', 'string', 'max:160'],
            'sort_weight' => ['sometimes', 'integer', 'between:-100000,100000'],
            'variants' => ['sometimes', 'nullable', 'array', 'max:500'],
            'variants.*' => ['array'],
            'variants.*.variant_id' => ['required', 'uuid', 'distinct'],
            'variants.*.compare_at_price' => ['sometimes', 'nullable', 'regex:/^\d{1,16}(\.\d{1,2})?$/'],
            'variants.*.image_id' => ['sometimes', 'nullable', 'uuid'],
        ];
    }

    public function messages(): array
    {
        return [
            'slug.regex' => 'Use lower-case letters, digits and single hyphens only.',
            'unpublished_at.after' => 'The end of the publishing window must be after its start.',
            'variants.*.compare_at_price.regex' => 'Enter an amount such as 140 or 140.50.',
        ];
    }

    /**
     * Validated data with list order kept.
     *
     * @return array<string, mixed>
     */
    public function listingData(): array
    {
        $data = $this->validated();
        foreach (['specifications', 'variants'] as $key) {
            if (isset($data[$key])) {
                ksort($data[$key]);
                $data[$key] = array_values($data[$key]);
            }
        }
        if (array_key_exists('specifications', $data) && $data['specifications'] === null) {
            $data['specifications'] = [];
        }

        return $data;
    }
}
