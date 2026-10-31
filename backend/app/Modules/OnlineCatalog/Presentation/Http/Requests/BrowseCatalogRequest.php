<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Requests;

use App\Modules\OnlineCatalog\Application\Queries\BrowseCatalog;
use App\Modules\OnlineCatalog\Domain\CatalogSort;
use App\Modules\Shared\Domain\Slug;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Query string of the shop listing. Single values are accepted where lists are expected
 * (`brand=x` as well as `brand[]=x`), and `slugs=a,b,c` switches to the exact-list mode.
 */
class BrowseCatalogRequest extends FormRequest
{
    public const MAX_SLUGS = 12;

    private const DECIMAL = 'regex:/^\d{1,16}(\.\d{1,2})?$/';

    protected function prepareForValidation(): void
    {
        $merge = [];
        if (is_string($this->query('brand'))) {
            $merge['brand'] = array_values(array_filter(explode(',', $this->query('brand'))));
        }
        $attr = $this->query('attr');
        if (is_array($attr)) {
            $merge['attr'] = array_map(fn ($v) => is_string($v) ? array_values(array_filter(explode(',', $v), fn ($x) => $x !== '')) : $v, $attr);
        }
        if (is_string($this->query('slugs'))) {
            $merge['slugs'] = array_values(array_filter(array_map(fn ($s) => mb_strtolower(trim($s)), explode(',', $this->query('slugs'))), fn ($s) => $s !== ''));
        }
        $this->merge($merge);
    }

    public function rules(): array
    {
        return [
            'q' => ['sometimes', 'nullable', 'string', 'max:100'],
            'category' => ['sometimes', 'nullable', 'string', 'max:120'],
            'brand' => ['sometimes', 'array', 'max:50'],
            'brand.*' => ['string', 'max:120'],
            'price_min' => ['sometimes', 'nullable', self::DECIMAL],
            'price_max' => ['sometimes', 'nullable', self::DECIMAL],
            'attr' => ['sometimes', 'array', 'max:20'],
            'attr.*' => ['array', 'max:50'],
            'attr.*.*' => ['string', 'max:60'],
            'in_stock' => ['sometimes', 'boolean'],
            'on_sale' => ['sometimes', 'boolean'],
            'sort' => ['sometimes', Rule::enum(CatalogSort::class)],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
            'per_page' => ['sometimes', 'integer', Rule::in(BrowseCatalog::PER_PAGE)],
            'slugs' => ['sometimes', 'array', 'max:'.self::MAX_SLUGS],
            'slugs.*' => ['string', 'max:120', 'regex:'.Slug::PATTERN],
        ];
    }

    public function messages(): array
    {
        return [
            'price_min.regex' => 'Enter an amount such as 100 or 99.50.',
            'price_max.regex' => 'Enter an amount such as 100 or 99.50.',
            'per_page.in' => 'Choose 12, 24, 36 or 48 products per page.',
        ];
    }
}
