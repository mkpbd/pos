<?php

namespace App\Modules\Storefront\Domain\Builder;

use Closure;

/**
 * B14: props of the store page template elements for BuilderDocumentSchema, like the other
 * normalizers (every key present afterwards, unknown keys dropped, each value checked):
 *
 * - dynamic_text: a field of the page context (`store.*` everywhere, plus the template's own
 *   fields, ElementRegistry::TEMPLATE_FIELDS), shown in `tag` with prefix / suffix, a fallback
 *   when the field has no value and a format. Rendered by the storefront from the page context.
 * - product_listing: the store's listing — `scope` (`current` in the listing templates only;
 *   `all`, chosen `categories` / `brands` (1–20 ids, ownership checked by BuilderReferences),
 *   `on_sale`, `new_arrivals` elsewhere), filters, layout, default sort, page size, columns.
 * - blog_post_body / order_summary / not_found_message: what the main part shows.
 *
 * `$context` is the document context (`template` for store page templates) and `$template` the
 * template key, or null when it is not known (a section template checked for where it fits).
 */
final class B14ElementProps extends ElementProps
{
    public const FIELD_ERROR = 'FIELD_NOT_AVAILABLE';

    /**
     * @param  Closure(string, string, ?string=): void  $error  path relative to the props, message, code
     */
    public function __construct(Closure $error, private readonly string $context, private readonly ?string $template)
    {
        parent::__construct($error);
    }

    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $max = ElementRegistry::TRANSLATABLE[$type] ?? [];

        return match ($type) {
            'dynamic_text' => [
                'field' => $this->field(),
                'tag' => $this->enum('tag', ElementRegistry::DYNAMIC_TEXT_TAGS),
                'prefix' => $this->text($this->raw('prefix'), 'prefix', 0, $max['prefix']),
                'suffix' => $this->text($this->raw('suffix'), 'suffix', 0, $max['suffix']),
                'fallback' => $this->text($this->raw('fallback'), 'fallback', 0, $max['fallback']),
                'format' => $this->enum('format', ElementRegistry::DYNAMIC_TEXT_FORMATS),
            ],
            'product_listing' => $this->listing(),
            'blog_post_body' => [
                'show_cover' => $this->bool('show_cover'),
                'show_meta' => $this->bool('show_meta'),
                'show_share' => $this->bool('show_share'),
                'show_related' => $this->bool('show_related'),
            ],
            'order_summary' => [
                'show_timeline' => $this->bool('show_timeline'),
                'show_items' => $this->bool('show_items'),
                'show_address' => $this->bool('show_address'),
                'show_delivery' => $this->bool('show_delivery'),
            ],
            'not_found_message' => [
                'heading' => $this->text($this->raw('heading'), 'heading', 0, $max['heading']),
                'text' => $this->text($this->raw('text'), 'text', 0, $max['text']),
                'show_search' => $this->bool('show_search'),
                'show_links' => $this->bool('show_links'),
            ],
            default => [],
        };
    }

    /**
     * The fields a document may show: `store.*`, plus its template's (every template's when the
     * template is not known).
     *
     * @return list<string>
     */
    public static function fields(string $context, ?string $template): array
    {
        if ($context !== 'template') {
            return ElementRegistry::STORE_FIELDS;
        }
        $own = $template === null
            ? array_merge(...array_values(ElementRegistry::TEMPLATE_FIELDS))
            : ElementRegistry::TEMPLATE_FIELDS[$template];

        return [...$own, ...ElementRegistry::STORE_FIELDS];
    }

    private function field(): string
    {
        $field = $this->raw('field');
        $known = array_merge(ElementRegistry::STORE_FIELDS, ...array_values(ElementRegistry::TEMPLATE_FIELDS));
        if (! is_string($field) || ! in_array($field, $known, true)) {
            $this->fail('field', 'Choose a field of this page.');

            return $this->defaults['field'];
        }
        if (! in_array($field, self::fields($this->context, $this->template), true)) {
            ($this->error)('field', "This page has no “{$field}”. Choose one of this page's fields.", self::FIELD_ERROR);

            return $this->defaults['field'];
        }

        return $field;
    }

    /**
     * @return array<string, mixed>
     */
    private function listing(): array
    {
        $scope = $this->enum('scope', ElementRegistry::LISTING_SCOPES);
        if ($this->template !== null && $scope !== 'current') {
            // A listing template's main part lists the page's own products.
            $this->fail('scope', "On this store page the listing shows this page's own products.");
            $scope = 'current';
        } elseif ($this->context !== 'template' && $scope === 'current') {
            $this->fail('scope', 'Choose which products to list.');
            $scope = 'all';
        }

        $ids = function (string $key, bool $used): array {
            $raw = $this->raw($key);
            if (! $used) {
                return [];
            }
            [$min, $max] = ElementRegistry::LISTING_IDS;
            $noun = $key === 'category_ids' ? 'categories' : 'brands';
            if (! is_array($raw) || ! array_is_list($raw) || count($raw) < $min || count($raw) > $max) {
                $this->fail($key, "Choose {$min} to {$max} {$noun}.");

                return [];
            }
            $result = [];
            foreach ($raw as $i => $id) {
                $id = $this->uuid($id, "{$key}.{$i}", $key === 'category_ids' ? 'Choose one of your categories.' : 'Choose one of your brands.');
                if ($id !== null && ! in_array($id, $result, true)) {
                    $result[] = $id;
                }
            }

            return $result;
        };

        $filters = $this->raw('filters');
        $normalizedFilters = [];
        if (! is_array($filters)) {
            $this->fail('filters', 'The filters are {'.implode(', ', ElementRegistry::LISTING_FILTERS).'}.');
            $filters = [];
        }
        foreach (ElementRegistry::LISTING_FILTERS as $filter) {
            $normalizedFilters[$filter] = $this->boolOf($filters[$filter] ?? true, "filters.{$filter}", true);
        }

        $perPage = $this->raw('per_page');
        if (! in_array($perPage, ElementRegistry::LISTING_PER_PAGE, true)) {
            $this->fail('per_page', 'Choose 12, 24, 36 or 48 products per page.');
            $perPage = $this->defaults['per_page'];
        }

        $columns = $this->raw('columns');
        $normalizedColumns = [];
        if (! is_array($columns)) {
            $this->fail('columns', 'The columns are {desktop, tablet, mobile}.');
            $columns = [];
        }
        foreach (ElementRegistry::LISTING_COLUMNS as $device => $choices) {
            $value = $columns[$device] ?? $this->defaults['columns'][$device];
            if (! in_array($value, $choices, true)) {
                $this->fail("columns.{$device}", 'Choose one of: '.implode(', ', $choices).'.');
                $value = $this->defaults['columns'][$device];
            }
            $normalizedColumns[$device] = $value;
        }

        return [
            'scope' => $scope,
            'category_ids' => $ids('category_ids', $scope === 'categories'),
            'brand_ids' => $ids('brand_ids', $scope === 'brands'),
            'filters' => $normalizedFilters,
            'filter_layout' => $this->enum('filter_layout', ElementRegistry::LISTING_FILTER_LAYOUTS),
            'sort_default' => $this->enum('sort_default', ElementRegistry::LISTING_SORTS),
            'per_page' => $perPage,
            'columns' => $normalizedColumns,
            'show_count' => $this->bool('show_count'),
            'pagination' => $this->enum('pagination', ElementRegistry::LISTING_PAGINATIONS),
        ];
    }
}
