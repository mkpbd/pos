<?php

namespace App\Modules\OnlineCatalog\Infrastructure\ReadModels;

use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * AI2a: what the online store's AI help reads — products without a category (category
 * suggestions), product facts for the model (names, brand, option names and values; never
 * prices, stock or costs) and bundle ideas from product_affinities. Reads the Products tables
 * read-only like CatalogReadModel; every query is filtered by organization.
 */
class CatalogAssistantReadModel
{
    /**
     * Ids of the newest active (not archived) products without a category.
     *
     * @return list<string>
     */
    public function uncategorizedProductIds(string $organizationId, int $limit): array
    {
        return DB::table('products')
            ->where('organization_id', $organizationId)
            ->whereNull('deleted_at')
            ->where('is_active', true)
            ->whereNull('category_id')
            ->orderByDesc('created_at')->orderByDesc('id')
            ->limit($limit)
            ->pluck('id')->map(fn ($id) => (string) $id)->all();
    }

    /**
     * Products of the organization (archived ones left out) keyed by id, in the given order.
     *
     * @param  list<string>  $productIds
     * @return array<string, array{id: string, name: string, brand_id: ?string, category_id: ?string, options: list<array{name: string, values: list<string>}>}>
     */
    public function productFacts(string $organizationId, array $productIds): array
    {
        $productIds = array_values(array_unique($productIds));
        if ($productIds === []) {
            return [];
        }
        $rows = DB::table('products')
            ->where('organization_id', $organizationId)
            ->whereNull('deleted_at')
            ->whereIn('id', $productIds)
            ->get(['id', 'name', 'brand_id', 'category_id', 'options'])
            ->keyBy('id');

        $result = [];
        foreach ($productIds as $id) {
            $row = $rows->get($id);
            if ($row === null) {
                continue;
            }
            $options = is_string($row->options) ? (json_decode($row->options, true) ?: []) : [];
            $result[$id] = [
                'id' => (string) $row->id,
                'name' => (string) $row->name,
                'brand_id' => $row->brand_id,
                'category_id' => $row->category_id,
                'options' => array_values(array_filter(array_map(fn ($o) => is_array($o) && is_string($o['name'] ?? null) ? [
                    'name' => $o['name'],
                    'values' => array_values(array_filter($o['values'] ?? [], 'is_string')),
                ] : null, is_array($options) ? $options : []))),
            ];
        }

        return $result;
    }

    /**
     * Whether the storefront offers Bangla (the column's default when the store was never set up).
     */
    public function banglaEnabled(string $organizationId): bool
    {
        $value = DB::table('storefront_settings')->where('organization_id', $organizationId)->value('bangla_enabled');

        return $value === null ? true : (bool) $value;
    }

    /**
     * The last nightly co-purchase run of the organization.
     *
     * @return array{local_date: string, computed_at: string}|null
     */
    public function lastAffinityRun(string $organizationId): ?array
    {
        $run = DB::table('product_affinity_runs')->where('organization_id', $organizationId)->first(['local_date', 'computed_at']);

        return $run === null ? null : ['local_date' => substr((string) $run->local_date, 0, 10), 'computed_at' => (string) $run->computed_at];
    }

    /**
     * One page of bundle ideas: anchor products (live) with their best co-purchased live
     * products that are not yet among the anchor's hand-picked "frequently bought together",
     * ordered by the best pair's score, then the anchor's name.
     *
     * @return array{total: int, anchors: list<array{id: string, name: string, pairs: list<array{id: string, name: string, score: int}>}>}
     */
    public function bundleIdeas(string $organizationId, ?string $search, int $page, int $perPage, int $pairsPerAnchor): array
    {
        $base = DB::table('product_affinities as a')
            ->join('products as anchor', 'anchor.id', '=', 'a.product_id')
            ->join('products as other', 'other.id', '=', 'a.related_product_id')
            ->where('a.organization_id', $organizationId)
            ->where('anchor.organization_id', $organizationId)
            ->where('other.organization_id', $organizationId)
            ->where(fn (QueryBuilder $q) => $this->live($q, $organizationId, 'a.product_id'))
            ->where(fn (QueryBuilder $q) => $this->live($q, $organizationId, 'a.related_product_id'))
            ->whereNotExists(fn (QueryBuilder $s) => $s->from('related_products as r')
                ->where('r.organization_id', $organizationId)
                ->whereColumn('r.product_id', 'a.product_id')
                ->whereColumn('r.related_product_id', 'a.related_product_id')
                ->where('r.kind', 'frequently_bought'));
        $search = trim((string) $search);
        if ($search !== '') {
            $base->whereLike('anchor.name', '%'.addcslashes($search, '%_\\').'%');
        }

        $total = (int) (clone $base)->distinct()->count('a.product_id');
        $anchors = (clone $base)
            ->select('a.product_id', 'anchor.name')
            ->selectRaw('max(a.score) as top_score')
            ->groupBy('a.product_id', 'anchor.name')
            ->orderByDesc('top_score')->orderBy('anchor.name')->orderBy('a.product_id')
            ->forPage($page, $perPage)
            ->get();
        if ($anchors->isEmpty()) {
            return ['total' => $total, 'anchors' => []];
        }

        $pairs = (clone $base)
            ->whereIn('a.product_id', $anchors->pluck('product_id')->all())
            ->orderByDesc('a.score')->orderBy('a.related_product_id')
            ->get(['a.product_id', 'a.related_product_id', 'other.name', 'a.score']);
        $byAnchor = [];
        foreach ($pairs as $pair) {
            if (count($byAnchor[$pair->product_id] ?? []) < $pairsPerAnchor) {
                $byAnchor[$pair->product_id][] = ['id' => (string) $pair->related_product_id, 'name' => (string) $pair->name, 'score' => (int) $pair->score];
            }
        }

        return ['total' => $total, 'anchors' => $anchors->map(fn ($a) => [
            'id' => (string) $a->product_id,
            'name' => (string) $a->name,
            'pairs' => $byAnchor[$a->product_id] ?? [],
        ])->values()->all()];
    }

    /**
     * Hand-picked "frequently bought together" counts of products.
     *
     * @param  list<string>  $productIds
     * @return array<string, int>
     */
    public function frequentlyBoughtCounts(string $organizationId, array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        return DB::table('related_products')
            ->where('organization_id', $organizationId)
            ->whereIn('product_id', $productIds)
            ->where('kind', 'frequently_bought')
            ->groupBy('product_id')
            ->selectRaw('product_id, count(*) as picks')
            ->pluck('picks', 'product_id')->map(fn ($n) => (int) $n)->all();
    }

    /**
     * The product in `$column` is live: published inside its schedule, an active product
     * (not archived) with an active variant.
     */
    private function live(QueryBuilder $query, string $organizationId, string $column): void
    {
        $now = now();
        $query->whereExists(fn (QueryBuilder $s) => $s->from('product_listings as pl')
            ->join('products as p', 'p.id', '=', 'pl.product_id')
            ->whereColumn('pl.product_id', $column)
            ->where('pl.organization_id', $organizationId)
            ->whereNull('p.deleted_at')
            ->where('p.is_active', true)
            ->where('pl.is_published', true)
            ->where(fn (QueryBuilder $q) => $q->whereNull('pl.published_at')->orWhere('pl.published_at', '<=', $now))
            ->where(fn (QueryBuilder $q) => $q->whereNull('pl.unpublished_at')->orWhere('pl.unpublished_at', '>', $now))
            ->whereExists(fn (QueryBuilder $v) => $v->from('product_variants as v')
                ->whereColumn('v.product_id', 'p.id')->whereNull('v.deleted_at')->where('v.is_active', true)));
    }
}
