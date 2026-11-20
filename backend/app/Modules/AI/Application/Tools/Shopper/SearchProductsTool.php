<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: products on sale in the online store matching the shopper's words — live listings only
 * (exactly what the shop's search shows), at most six, with the price a shopper pays now.
 * A multi-word query without an exact match falls back to the products matching most of its
 * words.
 */
final class SearchProductsTool implements AiTool
{
    public const NAME = 'search_products';

    public const MAX_RESULTS = 6;

    private const MAX_WORDS = 4;

    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly ShopperFindings $findings,
        private readonly string $currency,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'Search the products this online store sells (live listings only). Returns at most 6 products with name, web address slug, category, '
            .'the price a shopper pays now ('.$this->currency.'), whether it is in stock, rating and a short description, plus matching categories. '
            .'Use short keywords (a product type, brand or name), not whole sentences.',
            Arguments::schema([
                'query' => ['type' => 'string', 'description' => 'Search words, e.g. "cotton shirt" or a brand name (1–100 characters)'],
                'category_slug' => ['type' => 'string', 'description' => 'Only this category (a slug returned by an earlier search), optional'],
                'max_price' => ['type' => 'number', 'description' => 'Highest regular price in '.$this->currency.', optional'],
                'in_stock_only' => ['type' => 'boolean', 'description' => 'Only products in stock (default false)'],
            ], ['query']),
        );
    }

    public function run(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['query', 'category_slug', 'max_price', 'in_stock_only']), [
            'query' => ['required', 'string', 'max:100'],
            'category_slug' => ['sometimes', 'string', 'max:100', 'regex:/^[\pL\pN-]+$/u'],
            'max_price' => ['sometimes', 'numeric', 'min:0', 'max:1000000000'],
            'in_stock_only' => ['sometimes', 'boolean'],
        ])->validate();
        $query = trim((string) $args['query']);
        $params = array_filter([
            'category' => isset($args['category_slug']) ? mb_strtolower($args['category_slug']) : null,
            'price_max' => isset($args['max_price']) ? Decimal::round((string) $args['max_price'], 2) : null,
            'in_stock' => (bool) ($args['in_stock_only'] ?? false) ?: null,
            'per_page' => 12,
            'page' => 1,
        ], fn ($v) => $v !== null);

        try {
            $result = $this->catalog->listing(['q' => $query] + $params);
            $cards = $result['data'];
            $total = (int) ($result['meta']['total'] ?? count($cards));
            $categories = $result['facets']['categories'] ?? [];
            if ($total === 0) {
                [$cards, $total] = $this->byWords($query, $params);
            }
        } catch (ModelNotFoundException) {
            throw new BusinessRuleViolation('UNKNOWN_CATEGORY', 'Unknown category. Search again without category_slug.');
        }

        $products = [];
        foreach (array_slice($cards, 0, self::MAX_RESULTS) as $card) {
            $this->findings->productFrom($card, $this->currency);
            $products[] = [
                'slug' => $card['slug'],
                'name' => $card['name'],
                'url' => '/product/'.$card['slug'],
                'category' => $card['category']['name'] ?? null,
                'price_text' => ShopperText::price($card, $this->currency),
                'regular_price_text' => ShopperText::regularPrice($card, $this->currency),
                'on_sale' => ShopperText::regularPrice($card, $this->currency) !== null,
                'in_stock' => (bool) $card['in_stock'],
                'rating' => $card['rating'] ?? null,
                'short_description' => ShopperText::clip($card['short_description'] ?? null, 300),
            ];
        }

        return new ToolOutput(
            data: [
                'products' => $products,
                'shown' => count($products),
                'total_matches' => $total,
                'categories' => array_map(fn (array $c) => ['slug' => $c['slug'], 'name' => $c['name']], array_slice($categories, 0, 8)),
                'currency' => $this->currency,
            ],
            params: ['query' => mb_substr($query, 0, 60)] + array_intersect_key($args, ['category_slug' => true, 'max_price' => true, 'in_stock_only' => true]),
        );
    }

    /**
     * Products matching the most words of the query (each word searched on its own).
     *
     * @param  array<string, mixed>  $params
     * @return array{0: list<array<string, mixed>>, 1: int}
     */
    private function byWords(string $query, array $params): array
    {
        $words = preg_split('/[^\p{L}\p{N}\p{M}-]+/u', mb_strtolower($query), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $words = array_slice(array_values(array_unique(array_filter($words, fn (string $w) => mb_strlen($w) >= 3))), 0, self::MAX_WORDS);
        if (count($words) < 2) {
            return [[], 0];
        }

        $hits = [];
        $cards = [];
        foreach ($words as $word) {
            foreach ($this->catalog->listing(['q' => $word] + $params)['data'] as $position => $card) {
                $slug = (string) $card['slug'];
                $cards[$slug] ??= $card;
                $hits[$slug] = ($hits[$slug] ?? [0, $position]);
                $hits[$slug][0]++;
            }
        }
        uksort($hits, fn (string $a, string $b) => [$hits[$b][0], $hits[$a][1]] <=> [$hits[$a][0], $hits[$b][1]]);

        return [array_values(array_map(fn (string $slug) => $cards[$slug], array_keys($hits))), count($hits)];
    }
}
