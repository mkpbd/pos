<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuide;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuideCategory;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Support\TranslationInput;

/**
 * P1a: size guides for staff and the product page. A product shows its listing's own guide,
 * else the guide of its category or of the nearest ancestor category that has one.
 */
class SizeGuides
{
    /** @var array<string, string>|null category id => guide id */
    private ?array $byCategory = null;

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly MediaLibrary $media,
    ) {}

    /**
     * @return list<array{id: string, name: string, title: string, category_ids: list<string>, products_count: int, updated_at: ?string}>
     */
    public function list(): array
    {
        $guides = SizeGuide::query()->orderBy('name')->orderBy('id')->get(['id', 'name', 'title', 'updated_at']);
        $categories = SizeGuideCategory::query()->orderBy('category_id')->get(['size_guide_id', 'category_id'])->groupBy('size_guide_id');
        $counts = ProductListing::query()->whereNotNull('size_guide_id')->groupBy('size_guide_id')
            ->selectRaw('size_guide_id, count(*) as aggregate')->pluck('aggregate', 'size_guide_id')->all();

        return $guides->map(fn (SizeGuide $g) => [
            'id' => $g->id,
            'name' => $g->name,
            'title' => $g->title,
            'category_ids' => ($categories[$g->id] ?? collect())->pluck('category_id')->values()->all(),
            'products_count' => (int) ($counts[$g->id] ?? 0),
            'updated_at' => $g->updated_at?->toIso8601String(),
        ])->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function show(SizeGuide $guide): array
    {
        $image = $guide->image_media_id === null ? null : ($this->media->refs([$guide->image_media_id])[$guide->image_media_id] ?? null);
        $translations = TranslationInput::present(null);
        foreach ($guide->translations ?? [] as $locale => $doc) {
            if (array_key_exists($locale, $translations) && is_array($doc)) {
                $translations[$locale] = [
                    'title' => $doc['title'] ?? null,
                    'intro' => $doc['intro'] ?? null,
                    'note' => $doc['note'] ?? null,
                    'columns' => (object) ($doc['columns'] ?? []),
                    'cells' => (object) array_map(fn ($cells) => (object) $cells, $doc['cells'] ?? []),
                ];
            }
        }

        return [
            'id' => $guide->id,
            'name' => $guide->name,
            'title' => $guide->title,
            'intro' => $guide->intro,
            'columns' => $guide->table['columns'] ?? [],
            'rows' => array_map(fn (array $r) => ['id' => $r['id'], 'cells' => (object) $r['cells']], $guide->table['rows'] ?? []),
            'note' => $guide->note,
            'image_media_id' => $guide->image_media_id,
            'image' => $image,
            'category_ids' => SizeGuideCategory::query()->where('size_guide_id', $guide->id)->orderBy('category_id')->pluck('category_id')->all(),
            'translations' => $translations,
            'updated_at' => $guide->updated_at?->toIso8601String(),
        ];
    }

    /**
     * The guide a product without its own guide gets from its category tree, as {id, name}.
     *
     * @return array{id: string, name: string}|null
     */
    public function inherited(?string $categoryId): ?array
    {
        $id = $this->categoryGuideId($categoryId);
        if ($id === null) {
            return null;
        }
        $guide = SizeGuide::query()->find($id, ['id', 'name']);

        return $guide === null ? null : ['id' => $guide->id, 'name' => $guide->name];
    }

    /**
     * The product page's guide in the request's language, or null.
     *
     * @return array{title: string, intro: ?string, columns: list<array{id: string, label: string}>, rows: list<array{id: string, cells: object}>, note: ?string, image: array<string, mixed>|null}|null
     */
    public function forProduct(?string $listingGuideId, ?string $categoryId): ?array
    {
        $id = $listingGuideId ?? $this->categoryGuideId($categoryId);
        $guide = $id === null ? null : SizeGuide::query()->find($id);
        if ($guide === null) {
            return null;
        }

        $doc = $guide->translations[$this->catalog->locale()] ?? [];
        $pick = fn (mixed $translated, mixed $base) => is_string($translated) && trim($translated) !== '' ? $translated : $base;

        return [
            'title' => $pick($doc['title'] ?? null, $guide->title),
            'intro' => $pick($doc['intro'] ?? null, $guide->intro),
            'columns' => array_map(fn (array $c) => ['id' => $c['id'], 'label' => $pick($doc['columns'][$c['id']] ?? null, $c['label'])], $guide->table['columns'] ?? []),
            'rows' => array_map(function (array $r) use ($doc, $pick) {
                $cells = [];
                foreach ($r['cells'] as $columnId => $text) {
                    $cells[$columnId] = $pick($doc['cells'][$r['id']][$columnId] ?? null, $text);
                }

                return ['id' => $r['id'], 'cells' => (object) $cells];
            }, $guide->table['rows'] ?? []),
            'note' => $pick($doc['note'] ?? null, $guide->note),
            'image' => $guide->image_media_id === null ? null : ($this->media->refs([$guide->image_media_id])[$guide->image_media_id] ?? null),
        ];
    }

    private function categoryGuideId(?string $categoryId): ?string
    {
        $this->byCategory ??= SizeGuideCategory::query()->pluck('size_guide_id', 'category_id')->all();
        $tree = $this->catalog->categoryTree();
        $seen = [];
        while ($categoryId !== null && ! isset($seen[$categoryId])) {
            if (isset($this->byCategory[$categoryId])) {
                return $this->byCategory[$categoryId];
            }
            $seen[$categoryId] = true;
            $categoryId = $tree->node($categoryId)['parent_id'] ?? null;
        }

        return null;
    }
}
