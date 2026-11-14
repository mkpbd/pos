<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuide;
use App\Modules\OnlineCatalog\Infrastructure\Models\SizeGuideCategory;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Localization\LocaleContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P1a: size guides (create, replace, delete) and the categories that use them. A category
 * uses at most one guide; a product's listing may name its own guide instead.
 *
 * The table is `{columns: [{id, label}], rows: [{id, cells: {column id: text}}]}` (≤ 12 columns,
 * ≤ 40 rows; missing cells become ""). Bangla lives in `translations.bn`: title, intro, note,
 * `columns: {column id: label}` and `cells: {row id: {column id: text}}`; blank entries are
 * dropped and the base text shows instead.
 */
class ManageSizeGuides
{
    public const MAX_COLUMNS = 12;

    public const MAX_ROWS = 40;

    public const ID_PATTERN = '/^[A-Za-z0-9_-]{1,36}$/';

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly MediaLibrary $media,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public function save(?SizeGuide $guide, array $data): SizeGuide
    {
        $table = $this->table($data);
        $translations = array_key_exists('translations', $data)
            ? $this->translations($data['translations'], $table)
            : ($guide === null ? null : $this->translations($guide->translations, $table));
        $categoryIds = array_key_exists('category_ids', $data) ? array_values(array_unique($data['category_ids'] ?? [])) : null;

        $errors = [];
        if (($data['image_media_id'] ?? null) !== null && $this->media->existing([$data['image_media_id']]) === []) {
            $errors['image_media_id'] = ['Choose an image from the media library.'];
        }
        if ($categoryIds !== null) {
            $tree = $this->catalog->categoryTree();
            $taken = SizeGuideCategory::query()->whereIn('category_id', $categoryIds)
                ->when($guide !== null, fn ($q) => $q->where('size_guide_id', '!=', $guide->id))
                ->pluck('size_guide_id', 'category_id')->all();
            $names = SizeGuide::query()->whereKey(array_values($taken))->pluck('name', 'id')->all();
            foreach ($categoryIds as $i => $categoryId) {
                if (! $tree->has($categoryId)) {
                    $errors["category_ids.{$i}"] = ['This category does not exist.'];
                } elseif (isset($taken[$categoryId])) {
                    $errors["category_ids.{$i}"] = ['This category already uses the size guide "'.($names[$taken[$categoryId]] ?? '').'".'];
                }
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($guide, $data, $table, $translations, $categoryIds) {
            $creating = $guide === null;
            $guide ??= new SizeGuide;
            $before = $creating ? [] : $this->snapshot($guide);

            $guide->fill([
                'name' => trim($data['name']),
                'title' => trim($data['title']),
                'intro' => self::text($data['intro'] ?? null),
                'note' => self::text($data['note'] ?? null),
                'table' => $table,
                'image_media_id' => $data['image_media_id'] ?? null,
                'translations' => $translations,
            ])->save();

            if ($categoryIds !== null) {
                SizeGuideCategory::query()->where('size_guide_id', $guide->id)->whereNotIn('category_id', $categoryIds)->get()->each->delete();
                $current = SizeGuideCategory::query()->where('size_guide_id', $guide->id)->pluck('category_id')->all();
                foreach (array_diff($categoryIds, $current) as $categoryId) {
                    SizeGuideCategory::query()->create(['size_guide_id' => $guide->id, 'category_id' => $categoryId]);
                }
            }

            $after = $this->snapshot($guide);
            if ($creating || $before !== $after) {
                $this->audit->record($creating ? 'online_catalog.size_guide.created' : 'online_catalog.size_guide.updated', $guide, $before === [] ? [] : $before, $after);
            }

            return $guide;
        });
    }

    public function delete(SizeGuide $guide): void
    {
        DB::transaction(function () use ($guide) {
            $this->audit->record('online_catalog.size_guide.deleted', $guide, $this->snapshot($guide));
            // Category assignments go with the guide; listings fall back to their category's guide.
            $guide->delete();
        });
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{columns: list<array{id: string, label: string}>, rows: list<array{id: string, cells: array<string, string>}>}
     */
    private function table(array $data): array
    {
        $errors = [];
        $columns = [];
        foreach (array_values($data['columns'] ?? []) as $i => $column) {
            $id = (string) $column['id'];
            if (isset($columns[$id])) {
                $errors["columns.{$i}.id"] = ['Two columns have the same id.'];
            }
            $columns[$id] = ['id' => $id, 'label' => trim((string) $column['label'])];
        }

        $rows = [];
        $seen = [];
        foreach (array_values($data['rows'] ?? []) as $i => $row) {
            $id = (string) $row['id'];
            if (isset($seen[$id])) {
                $errors["rows.{$i}.id"] = ['Two rows have the same id.'];
            }
            $seen[$id] = true;
            $cells = [];
            foreach ($row['cells'] ?? [] as $columnId => $text) {
                if (! isset($columns[(string) $columnId])) {
                    $errors["rows.{$i}.cells.{$columnId}"] = ['This column does not exist.'];
                }
            }
            foreach ($columns as $columnId => $column) {
                $cells[$columnId] = trim((string) ($row['cells'][$columnId] ?? ''));
            }
            $rows[] = ['id' => $id, 'cells' => $cells];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return ['columns' => array_values($columns), 'rows' => $rows];
    }

    /**
     * The stored Bangla document: only known columns/rows, blanks dropped; null when empty.
     *
     * @param  array{columns: list<array{id: string, label: string}>, rows: list<array{id: string, cells: array<string, string>}>}  $table
     * @return array<string, array<string, mixed>>|null
     */
    private function translations(mixed $input, array $table): ?array
    {
        if (! is_array($input)) {
            return null;
        }
        $columnIds = array_column($table['columns'], 'id');
        $rowIds = array_column($table['rows'], 'id');
        $result = [];
        foreach (LocaleContext::TRANSLATABLE as $locale) {
            $source = $input[$locale] ?? null;
            if (! is_array($source)) {
                continue;
            }
            $doc = [];
            foreach (['title', 'intro', 'note'] as $field) {
                if (($text = self::text($source[$field] ?? null)) !== null) {
                    $doc[$field] = $text;
                }
            }
            foreach ((array) ($source['columns'] ?? []) as $columnId => $label) {
                if (in_array((string) $columnId, $columnIds, true) && ($text = self::text($label)) !== null) {
                    $doc['columns'][(string) $columnId] = $text;
                }
            }
            foreach ((array) ($source['cells'] ?? []) as $rowId => $cells) {
                if (! in_array((string) $rowId, $rowIds, true) || ! is_array($cells)) {
                    continue;
                }
                foreach ($cells as $columnId => $value) {
                    if (in_array((string) $columnId, $columnIds, true) && ($text = self::text($value)) !== null) {
                        $doc['cells'][(string) $rowId][(string) $columnId] = $text;
                    }
                }
            }
            if ($doc !== []) {
                $result[$locale] = $doc;
            }
        }

        return $result === [] ? null : $result;
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(SizeGuide $guide): array
    {
        return [
            'name' => $guide->name,
            'title' => $guide->title,
            'table_hash' => hash('xxh128', (string) json_encode($guide->table)),
            'image_media_id' => $guide->image_media_id,
            'translations_hash' => $guide->translations === null ? null : hash('xxh128', (string) json_encode($guide->translations)),
            'category_ids' => SizeGuideCategory::query()->where('size_guide_id', $guide->id)->orderBy('category_id')->pluck('category_id')->all(),
        ];
    }
}
