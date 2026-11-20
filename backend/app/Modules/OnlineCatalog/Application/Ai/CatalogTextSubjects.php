<?php

namespace App\Modules\OnlineCatalog\Application\Ai;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFormat;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Domain\Translations;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

/**
 * AI2a: the products, categories and brands of the current organization as the AI writer sees
 * them — catalog facts only (names, category path, brand, unit, variant options, specifications,
 * existing descriptions as plain text). Never prices, stock, costs, suppliers or sales.
 *
 * @phpstan-type Texts array{en: array<string, ?string>, bn: array<string, ?string>}
 */
class CatalogTextSubjects
{
    /** Names of products / subcategories given as context for a category or brand. */
    private const CONTEXT_NAMES = 10;

    /** An existing text sent for a rewrite is cut to this many characters. */
    private const EXISTING_TEXT_MAX = 3000;

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly CatalogDirectory $directory,
    ) {}

    public function storeName(): ?string
    {
        return $this->catalog->siteName();
    }

    /**
     * One subject with its facts and current texts.
     *
     * @return array{id: string, name: string, facts: array<string, mixed>, texts: Texts}
     *
     * @throws ModelNotFoundException when it is not one of the organization's
     */
    public function load(string $subject, string $id): array
    {
        $id = strtolower($id);

        return match ($subject) {
            'product' => $this->product($id),
            'category' => $this->category($id),
            'brand' => $this->brand($id),
        };
    }

    /**
     * Display names of subjects that exist (deleted products are left out), keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    public function names(string $subject, array $ids): array
    {
        $ids = array_values(array_unique(array_map('strtolower', $ids)));
        if ($ids === []) {
            return [];
        }
        if ($subject === 'product') {
            $names = [];
            foreach (array_chunk($ids, 500) as $chunk) {
                $names += DB::table('products')->where('organization_id', $this->catalog->organizationId())
                    ->whereIn('id', $chunk)->whereNull('deleted_at')->pluck('name', 'id')->all();
            }

            return $names;
        }
        $all = $subject === 'category' ? $this->categoryNames() : array_map(fn (array $b) => (string) ($b['base_name'] ?? $b['name']), $this->catalog->brands());

        return array_intersect_key($all, array_flip($ids));
    }

    /**
     * Current texts of many subjects (`en` = the listing fields, `bn` = their Bangla
     * translations), keyed by subject id; a subject without a listing has nulls.
     *
     * @param  list<string>  $ids
     * @return array<string, Texts>
     */
    public function texts(string $subject, array $ids): array
    {
        $ids = array_values(array_unique(array_map('strtolower', $ids)));
        $listings = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $listings += $this->listingQuery($subject)->whereIn(self::key($subject), $chunk)->get()->keyBy(self::key($subject))->all();
        }
        $result = [];
        foreach ($ids as $id) {
            $result[$id] = self::textsOf($subject, $listings[$id] ?? null);
        }

        return $result;
    }

    /**
     * Active subjects lacking texts, by name (at most $limit): `description` — no description;
     * `seo` — no SEO title or SEO description; `bangla` — a requested field without its Bangla
     * translation (only when Bangla is requested).
     *
     * @param  list<string>  $missing
     * @param  list<string>  $fields
     * @param  list<string>  $languages
     * @param  list<string>  $exclude  subject ids to leave out
     * @return list<array{id: string, name: string}>
     */
    public function lacking(string $subject, array $missing, array $fields, array $languages, array $exclude, int $limit): array
    {
        $candidates = match ($subject) {
            'product' => DB::table('products')->where('organization_id', $this->catalog->organizationId())
                ->whereNull('deleted_at')->where('is_active', true)
                ->orderBy('name')->orderBy('id')->get(['id', 'name'])
                ->map(fn ($r) => ['id' => (string) $r->id, 'name' => (string) $r->name])->all(),
            'category' => array_values(array_map(fn (array $c) => ['id' => $c['id'], 'name' => (string) ($c['base_name'] ?? $c['name'])], array_filter(
                $this->catalog->categoryTree()->flatten(), fn (array $c) => $c['is_active'],
            ))),
            'brand' => array_values(array_map(fn (array $b) => ['id' => $b['id'], 'name' => (string) ($b['base_name'] ?? $b['name'])], array_filter(
                $this->catalog->brands(), fn (array $b) => $b['is_active'],
            ))),
        };
        if ($subject !== 'product') {
            usort($candidates, fn (array $a, array $b) => [mb_strtolower($a['name']), $a['id']] <=> [mb_strtolower($b['name']), $b['id']]);
        }
        $excluded = array_flip($exclude);
        $candidates = array_values(array_filter($candidates, fn (array $c) => ! isset($excluded[$c['id']])));

        $result = [];
        foreach (array_chunk($candidates, 500) as $chunk) {
            $texts = $this->texts($subject, array_column($chunk, 'id'));
            foreach ($chunk as $candidate) {
                if (self::lacks($subject, $texts[$candidate['id']], $missing, $fields, $languages)) {
                    $result[] = $candidate;
                    if (count($result) >= $limit) {
                        return $result;
                    }
                }
            }
        }

        return $result;
    }

    /**
     * Writes texts to a subject's listing through the listing's own save action (validation,
     * sanitizing, audit). `$values` = `{<lang>: {<field>: text}}`. A listing created this way is
     * never published (products) or shown (categories, brands): staff publish it themselves.
     *
     * @param  array<string, array<string, string>>  $values
     * @return array<string, mixed> data for SaveProductListing / SaveCategoryListing / SaveBrandListing
     */
    public static function listingData(string $subject, array $values, bool $listingExists): array
    {
        $data = [];
        foreach ($values as $language => $fields) {
            foreach ($fields as $field => $text) {
                $column = CatalogTextFields::column($subject, $field);
                if ($language === 'en') {
                    $data[$column] = $text;
                } else {
                    $data['translations'][$language][$column] = $text;
                }
            }
        }
        if (! $listingExists && $subject !== 'product') {
            $data['is_visible'] = false;
        }

        return $data;
    }

    public function listingExists(string $subject, string $id): bool
    {
        return $this->listingQuery($subject)->where(self::key($subject), strtolower($id))->exists();
    }

    /**
     * @param  Texts  $texts
     * @param  list<string>  $missing
     * @param  list<string>  $fields
     * @param  list<string>  $languages
     */
    private static function lacks(string $subject, array $texts, array $missing, array $fields, array $languages): bool
    {
        $blank = fn (?string $text) => trim(strip_tags((string) $text)) === '';
        foreach ($missing as $criterion) {
            $lacks = match ($criterion) {
                'description' => $blank($texts['en']['description'] ?? null),
                'seo' => $blank($texts['en']['seo_title'] ?? null) || $blank($texts['en']['seo_description'] ?? null),
                'bangla' => in_array('bn', $languages, true) && array_filter(
                    CatalogTextFields::applicable($subject, $fields), fn (string $f) => $blank($texts['bn'][$f] ?? null),
                ) !== [],
                default => false,
            };
            if ($lacks) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{id: string, name: string, facts: array<string, mixed>, texts: Texts}
     */
    private function product(string $id): array
    {
        $product = $this->catalog->adminProducts([$id])[$id]
            ?? throw (new ModelNotFoundException)->setModel(ProductListing::class, [$id]);
        $listing = ProductListing::query()->where('product_id', $id)->first();
        $texts = self::textsOf('product', $listing);
        $unitId = DB::table('products')->where('id', $id)->value('unit_id');
        $unit = is_string($unitId) ? ($this->directory->describe($this->catalog->organizationId(), ['units' => [$unitId]])['units'][$unitId]['name'] ?? null) : null;
        $brand = $product['brand_id'] === null ? null : ($this->catalog->brands()[$product['brand_id']] ?? null);

        $options = [];
        foreach ($product['options'] as $option) {
            if (is_array($option) && is_string($option['name'] ?? null)) {
                $options[] = ['name' => $option['name'], 'values' => array_values(array_filter((array) ($option['values'] ?? []), 'is_string'))];
            }
        }

        return [
            'id' => $id,
            'name' => (string) $product['name'],
            'facts' => array_filter([
                'kind' => 'product',
                'name' => (string) $product['name'],
                'name_bn' => self::translated($listing, 'name'),
                'category' => $product['category_id'] === null ? null : $this->path($product['category_id']),
                'brand' => $brand === null ? null : (string) ($brand['base_name'] ?? $brand['name']),
                'unit' => $unit,
                'options' => $options,
                'specifications' => array_values(array_map(
                    fn (array $s) => ['label' => (string) ($s['label'] ?? ''), 'value' => (string) ($s['value'] ?? '')],
                    array_filter((array) ($listing->specifications ?? []), 'is_array'),
                )),
                'existing_texts' => self::existing($texts, ['short_description', 'description']),
            ], fn ($v) => $v !== null && $v !== []),
            'texts' => $texts,
        ];
    }

    /**
     * @return array{id: string, name: string, facts: array<string, mixed>, texts: Texts}
     */
    private function category(string $id): array
    {
        $tree = $this->catalog->categoryTree();
        $node = $tree->node($id) ?? throw (new ModelNotFoundException)->setModel(CategoryListing::class, [$id]);
        $listing = CategoryListing::query()->where('category_id', $id)->first();
        $texts = self::textsOf('category', $listing);
        $name = (string) ($node['base_name'] ?? $node['name']);
        $children = array_values(array_map(
            fn (array $c) => (string) ($c['base_name'] ?? $c['name']),
            array_filter($tree->flatten(), fn (array $c) => $c['parent_id'] === $id && $c['is_active']),
        ));

        return [
            'id' => $id,
            'name' => $name,
            'facts' => array_filter([
                'kind' => 'category',
                'name' => $name,
                'name_bn' => self::translated($listing, 'name'),
                'path' => $this->path($id),
                'subcategories' => array_slice($children, 0, self::CONTEXT_NAMES * 2),
                'example_products' => $this->productNames('category_id', $tree->withDescendants($id)),
                'existing_texts' => self::existing($texts, ['description']),
            ], fn ($v) => $v !== null && $v !== []),
            'texts' => $texts,
        ];
    }

    /**
     * @return array{id: string, name: string, facts: array<string, mixed>, texts: Texts}
     */
    private function brand(string $id): array
    {
        $brand = $this->catalog->brands()[$id] ?? throw (new ModelNotFoundException)->setModel(BrandListing::class, [$id]);
        $listing = BrandListing::query()->where('brand_id', $id)->first();
        $texts = self::textsOf('brand', $listing);
        $name = (string) ($brand['base_name'] ?? $brand['name']);

        return [
            'id' => $id,
            'name' => $name,
            'facts' => array_filter([
                'kind' => 'brand',
                'name' => $name,
                'name_bn' => self::translated($listing, 'name'),
                'example_products' => $this->productNames('brand_id', [$id]),
                'existing_texts' => self::existing($texts, ['description']),
            ], fn ($v) => $v !== null && $v !== []),
            'texts' => $texts,
        ];
    }

    /** "Clothing > Kids > T-shirts" (base names, root first). */
    private function path(string $categoryId): ?string
    {
        $names = $this->categoryNames();
        $ids = array_reverse($this->catalog->categoryTree()->selfAndAncestors($categoryId));
        $parts = array_values(array_filter(array_map(fn (string $c) => $names[$c] ?? null, $ids)));

        return $parts === [] ? null : implode(' > ', $parts);
    }

    /**
     * @return array<string, string>
     */
    private function categoryNames(): array
    {
        $names = [];
        foreach ($this->catalog->categoryTree()->flatten() as $c) {
            $names[$c['id']] = (string) ($c['base_name'] ?? $c['name']);
        }

        return $names;
    }

    /**
     * A few names of active products in categories / of a brand (context only).
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function productNames(string $column, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('products')->where('organization_id', $this->catalog->organizationId())
            ->whereIn($column, array_slice($ids, 0, 500))->whereNull('deleted_at')->where('is_active', true)
            ->orderByDesc('created_at')->orderBy('id')->limit(self::CONTEXT_NAMES)->pluck('name')
            ->map(fn ($n) => (string) $n)->all();
    }

    /**
     * @return Texts
     */
    private static function textsOf(string $subject, ?Model $listing): array
    {
        $texts = ['en' => [], 'bn' => []];
        $translations = Translations::decode($listing?->getAttribute('translations'));
        foreach (CatalogTextFields::forSubject($subject) as $field) {
            $column = CatalogTextFields::column($subject, $field);
            $base = $listing?->getAttribute($column);
            $texts['en'][$field] = is_string($base) && trim($base) !== '' ? $base : null;
            $bn = $translations['bn'][$column] ?? null;
            $texts['bn'][$field] = is_string($bn) && trim($bn) !== '' ? $bn : null;
        }

        return $texts;
    }

    /**
     * Existing texts as plain text for a rewrite, by language (only those that exist).
     *
     * @param  Texts  $texts
     * @param  list<string>  $fields
     * @return array<string, array<string, string>>
     */
    private static function existing(array $texts, array $fields): array
    {
        $result = [];
        foreach ($texts as $language => $values) {
            foreach ($fields as $field) {
                $plain = CatalogTextFormat::plain($values[$field] ?? null, true);
                if ($plain !== '') {
                    $result[$language][$field] = mb_substr($plain, 0, self::EXISTING_TEXT_MAX);
                }
            }
        }

        return $result;
    }

    private static function translated(?Model $listing, string $field): ?string
    {
        $value = Translations::decode($listing?->getAttribute('translations'))['bn'][$field] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /**
     * @return Builder<ProductListing>|Builder<CategoryListing>|Builder<BrandListing>
     */
    private function listingQuery(string $subject): Builder
    {
        return match ($subject) {
            'product' => ProductListing::query(),
            'category' => CategoryListing::query(),
            'brand' => BrandListing::query(),
        };
    }

    private static function key(string $subject): string
    {
        return $subject.'_id';
    }
}
