<?php

namespace App\Modules\Media\Infrastructure;

use App\Modules\Media\Application\Contracts\MediaReferences;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;

/**
 * B11: where a media item is used, in plain words, so "Replace the original" can say what
 * changes with it. Asks the tagged MediaReferences (ids kept inside JSON settings) and every
 * foreign key that points at the media table (read from PostgreSQL's catalog, so new ones
 * count without code here). Edited copies pointing at their source do not count as a use.
 */
class MediaUsage
{
    /** Plain-word names of the known MediaReferences implementations (by class name). */
    private const REFERENCE_LABELS = [
        'ThemeMediaReferences' => 'Store theme (logo or icons)',
        'SectionMediaReferences' => 'Homepage sections',
        'BuilderMediaReferences' => 'Store builder pages, versions or templates',
        'BlogMediaReferences' => 'Blog posts',
        'ListingMediaReferences' => 'Category, brand or size guide pages',
    ];

    /** Plain-word names of tables that point at media with a foreign key. */
    private const TABLE_LABELS = [
        'banners' => 'Banners',
        'menu_items' => 'Menus',
        'blog_posts' => 'Blog posts',
        'category_listings' => 'Category, brand or size guide pages',
        'brand_listings' => 'Category, brand or size guide pages',
        'size_guides' => 'Category, brand or size guide pages',
    ];

    /** @var list<array{table: string, column: string}>|null */
    private static ?array $foreignKeys = null;

    public function __construct(private readonly Container $container) {}

    /**
     * @return list<string>
     */
    public function places(string $mediaId): array
    {
        $places = [];

        /** @var iterable<MediaReferences> $references */
        $references = $this->container->tagged(MediaReferences::TAG);
        foreach ($references as $reference) {
            if ($reference->uses($mediaId)) {
                $places[] = self::REFERENCE_LABELS[class_basename($reference)] ?? 'Other store content';
            }
        }

        foreach ($this->foreignKeys() as ['table' => $table, 'column' => $column]) {
            // The media id is a uuid unique across organizations, so a lookup by it stays inside the owner's rows.
            if (DB::table($table)->where($column, $mediaId)->exists()) {
                $places[] = self::TABLE_LABELS[$table] ?? ucfirst(str_replace('_', ' ', $table));
            }
        }

        return array_values(array_unique($places));
    }

    /**
     * @return list<array{table: string, column: string}>
     */
    private function foreignKeys(): array
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            return [];
        }

        return self::$foreignKeys ??= array_map(
            fn (object $row) => ['table' => (string) $row->table_name, 'column' => (string) $row->column_name],
            DB::select(<<<'SQL'
                SELECT cl.relname AS table_name, att.attname AS column_name
                FROM pg_constraint con
                JOIN pg_class cl ON cl.oid = con.conrelid
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
                WHERE con.contype = 'f' AND con.confrelid = 'media'::regclass
                  AND array_length(con.conkey, 1) = 1 AND cl.relname <> 'media'
                ORDER BY cl.relname, att.attname
                SQL),
        );
    }
}
