<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\VideoUrl;
use App\Modules\Storefront\Domain\LinkTarget;
use App\Modules\Storefront\Domain\SectionConfigRules;
use App\Modules\Storefront\Domain\SectionType;
use DateTimeImmutable;
use Illuminate\Support\Facades\Validator;

/**
 * Builder document format v1 (B1): `{schema_version: 1, sections: Section[]}` with sections →
 * columns → elements (+ one level of `inner_row`). normalize() is pure (no database): it
 * checks structure, limits, ids, props and translations, normalizes styles (StyleSchema) and
 * returns the canonical document — every node with all its keys, unknown keys dropped — or
 * throws InvalidBuilderDocument listing every problem with its path and node id.
 * normalize(normalize(x)) === normalize(x). Ownership of referenced ids is checked
 * separately (Application\Builder\BuilderReferences), rich text is sanitized on save.
 *
 * B6: the B6 elements' props (B6ElementProps) with list translations `<list>.<item id>.<field>`;
 * sections may set `sticky` (at most one per document; pages, CMS pages and zones) and
 * `shape_top` / `shape_bottom` dividers — kept only when set, so older documents normalize
 * unchanged; sections and inner rows may have a `background.video` (StyleSchema).
 *
 * B8a: the B8a elements' props (B8ElementProps) with nested list translations
 * (`plans.<plan id>.features.<feature id>.text`, `rows.<row id>.cells.<column id>.text`).
 *
 * B8b: context `popup` (popup documents) — the document gains a `popup` settings object
 * (PopupSettings; `{schema_version, popup, sections}`), buttons there may have `action: dismiss`;
 * the `form` element (B8ElementFormProps).
 */
final class BuilderDocumentSchema
{
    public const SCHEMA_VERSION = 1;

    public const MAX_SECTIONS = 60;

    /** Sections + columns + elements. */
    public const MAX_NODES = 400;

    /** Encoded JSON size. */
    public const MAX_BYTES = 262144;

    public const MAX_COLUMNS = 6;

    public const MAX_ELEMENTS_PER_COLUMN = 40;

    public const COLUMN_WIDTH = [5, 100];

    public const ID_PATTERN = '^[a-z][a-z0-9_-]{1,31}$';

    public const ANCHOR_PATTERN = '^[a-z][a-z0-9-]{0,59}$';

    public const SECTION_LAYOUTS = ['boxed', 'full', 'full-bleed'];

    public const DEVICES = ['desktop', 'tablet', 'mobile'];

    /** B6: section shape dividers (`shape_top` / `shape_bottom`). */
    public const SHAPES = ['wave', 'curve', 'tilt', 'triangle', 'zigzag'];

    /** B6: a shape divider's height, px. */
    public const SHAPE_HEIGHT = [16, 200];

    /** B6: the contexts where a section may be sticky (at most one per document). */
    public const STICKY_CONTEXTS = ['page', 'cms', 'zone'];

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    private const INSTANT = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/';

    private const MAX_ERRORS = 50;

    /** @var list<array{path: string, node_id: ?string, message: string}> */
    private array $errors = [];

    /** @var array<string, true> */
    private array $ids = [];

    /** @var array<string, true> */
    private array $anchors = [];

    private int $nodes = 0;

    /** B6: the id of the document's sticky section, once one is found. */
    private ?string $sticky = null;

    /** B4: the document context (ElementRegistry::CONTEXTS) — which element types are allowed. */
    private function __construct(private readonly string $context) {}

    /**
     * @param  array<string, mixed>  $document
     * @param  string  $context  B4: `page` (home / landing), `cms`, `header`, `footer` or `zone`
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     *
     * @throws InvalidBuilderDocument
     */
    public static function normalize(array $document, string $context = 'page'): array
    {
        if (! in_array($context, ElementRegistry::CONTEXTS, true)) {
            throw new \InvalidArgumentException("Unknown builder document context \"{$context}\".");
        }

        return (new self($context))->document($document);
    }

    /**
     * B4: the context of a document key — `cms:<uuid>` → cms, `header`, `footer`, `zone:*` →
     * zone, everything else (home, landing pages) → page.
     */
    public static function contextOf(string $key): string
    {
        return match (true) {
            str_starts_with($key, 'cms:') => 'cms',
            $key === 'header', $key === 'footer' => $key,
            str_starts_with($key, 'zone:') => 'zone',
            // B8b.
            str_starts_with($key, 'popup:') => 'popup',
            default => 'page',
        };
    }

    /**
     * A document without content.
     *
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     */
    public static function blank(): array
    {
        return ['schema_version' => self::SCHEMA_VERSION, 'sections' => []];
    }

    /**
     * B8b: a popup without content, with the default settings.
     *
     * @return array{schema_version: int, popup: array<string, mixed>, sections: list<array<string, mixed>>}
     */
    public static function blankPopup(): array
    {
        return ['schema_version' => self::SCHEMA_VERSION, 'popup' => PopupSettings::defaults(), 'sections' => []];
    }

    /**
     * Calls `$visit(node, path, kind)` for every node of a (normalized) document, parents
     * before children; kind is `section`, `column` or `element`.
     *
     * @param  array<string, mixed>  $document
     * @param  callable(array<string, mixed>, string, string): void  $visit
     */
    public static function walk(array $document, callable $visit): void
    {
        foreach ($document['sections'] ?? [] as $s => $section) {
            $visit($section, "sections.{$s}", 'section');
            self::walkColumns($section['columns'] ?? [], "sections.{$s}.columns", $visit);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $columns
     */
    private static function walkColumns(array $columns, string $path, callable $visit): void
    {
        foreach ($columns as $c => $column) {
            $visit($column, "{$path}.{$c}", 'column');
            foreach ($column['elements'] ?? [] as $e => $element) {
                $visit($element, "{$path}.{$c}.elements.{$e}", 'element');
                if (isset($element['columns'])) {
                    self::walkColumns($element['columns'], "{$path}.{$c}.elements.{$e}.columns", $visit);
                }
            }
        }
    }

    /**
     * @param  array<string, mixed>  $document
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     */
    private function document(array $document): array
    {
        $size = strlen((string) json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        if ($size > self::MAX_BYTES) {
            throw new InvalidBuilderDocument([$this->entry('', null, 'The page is too large ('.$size.' bytes; at most '.self::MAX_BYTES.').')]);
        }

        $version = $document['schema_version'] ?? self::SCHEMA_VERSION;
        if ($version !== self::SCHEMA_VERSION) {
            $this->error('schema_version', null, 'Unsupported schema version; expected '.self::SCHEMA_VERSION.'.');
        }

        $sections = [];
        $raw = $document['sections'] ?? null;
        if (! is_array($raw) || ! array_is_list($raw)) {
            $this->error('sections', null, 'The sections must be a list.');
        } elseif (count($raw) > self::MAX_SECTIONS) {
            $this->error('sections', null, 'A page can have at most '.self::MAX_SECTIONS.' sections.');
        } else {
            foreach ($raw as $i => $section) {
                $normalized = $this->section($section, "sections.{$i}");
                if ($normalized !== null) {
                    $sections[] = $normalized;
                }
            }
        }

        if ($this->nodes > self::MAX_NODES) {
            $this->error('sections', null, 'A page can have at most '.self::MAX_NODES.' sections, columns and elements in all ('.$this->nodes.' given).');
        }
        // B8b: a popup's settings (other documents have none; the key is dropped).
        $popup = $this->context === 'popup'
            ? PopupSettings::normalize($document['popup'] ?? null, fn (string $path, string $message, ?string $code = null) => $this->error($path === '' ? 'popup' : "popup.{$path}", null, $message, $code))
            : null;
        if ($this->errors !== []) {
            throw new InvalidBuilderDocument($this->errors);
        }

        return $popup === null
            ? ['schema_version' => self::SCHEMA_VERSION, 'sections' => $sections]
            : ['schema_version' => self::SCHEMA_VERSION, 'popup' => $popup, 'sections' => $sections];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function section(mixed $node, string $path): ?array
    {
        if (! is_array($node)) {
            $this->error($path, null, 'A section must be an object.');

            return null;
        }
        $this->nodes++;
        $id = $this->id($node, $path);
        if (($node['type'] ?? 'section') !== 'section') {
            $this->error("{$path}.type", $id, 'The type of a section must be "section".');
        }

        $props = is_array($node['props'] ?? null) ? $node['props'] : [];
        $layout = $props['layout'] ?? 'boxed';
        if (! in_array($layout, self::SECTION_LAYOUTS, true)) {
            $this->error("{$path}.props.layout", $id, 'The layout must be one of: '.implode(', ', self::SECTION_LAYOUTS).'.');
            $layout = 'boxed';
        }
        $anchor = $props['anchor'] ?? null;
        if ($anchor !== null) {
            if (! is_string($anchor) || preg_match('/'.self::ANCHOR_PATTERN.'/', $anchor) !== 1) {
                $this->error("{$path}.props.anchor", $id, 'The anchor must be lower-case letters, digits and dashes, starting with a letter (at most 60).');
                $anchor = null;
            } elseif (isset($this->anchors[$anchor])) {
                $this->error("{$path}.props.anchor", $id, "The anchor \"{$anchor}\" is used by another section.");
            } else {
                $this->anchors[$anchor] = true;
            }
        }

        $sectionProps = ['layout' => $layout, 'anchor' => $anchor];
        // B6: `sticky` and the shape dividers are kept only when set (a section without them
        // normalizes exactly as before B6).
        $sticky = $props['sticky'] ?? false;
        if (! is_bool($sticky)) {
            $this->error("{$path}.props.sticky", $id, 'Sticky is true or false.');
        } elseif ($sticky) {
            if (! in_array($this->context, self::STICKY_CONTEXTS, true)) {
                $this->error("{$path}.props.sticky", $id, 'Only sections of pages, content pages and shop areas can stick to the top.');
            } elseif ($this->sticky !== null) {
                $this->error("{$path}.props.sticky", $id, 'Only one section of a page can stick to the top.');
            } else {
                $this->sticky = $id ?? '';
            }
            $sectionProps['sticky'] = true;
        }
        foreach (['shape_top', 'shape_bottom'] as $key) {
            $shape = $this->shape($props[$key] ?? null, "{$path}.props.{$key}", $id);
            if ($shape !== null) {
                $sectionProps[$key] = $shape;
            }
        }

        return [
            'id' => $id,
            'type' => 'section',
            'props' => $sectionProps,
            ...$this->common($node, $path, $id, [], true),
            'columns' => $this->columns($node['columns'] ?? null, "{$path}.columns", $id, false),
        ];
    }

    /**
     * B6: a section shape divider `{shape, color, height, flip}`, or null for none.
     *
     * @return array{shape: string, color: string, height: int, flip: bool}|null
     */
    private function shape(mixed $value, string $path, ?string $id): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            $this->error($path, $id, 'A shape divider is null or {shape, color, height, flip}.');

            return null;
        }
        $valid = true;
        $shape = $value['shape'] ?? null;
        if (! in_array($shape, self::SHAPES, true)) {
            $this->error("{$path}.shape", $id, 'Choose one of: '.implode(', ', self::SHAPES).'.');
            $valid = false;
        }
        $color = StyleSchema::color($value['color'] ?? null);
        if ($color === null) {
            $this->error("{$path}.color", $id, 'Use #rrggbb, #rrggbbaa or a theme colour (theme:<role>).');
            $valid = false;
        }
        $height = $value['height'] ?? 64;
        if (! is_int($height) || $height < self::SHAPE_HEIGHT[0] || $height > self::SHAPE_HEIGHT[1]) {
            $this->error("{$path}.height", $id, 'Enter a whole number from '.self::SHAPE_HEIGHT[0].' to '.self::SHAPE_HEIGHT[1].'.');
            $valid = false;
        }
        $flip = $value['flip'] ?? false;
        if (! is_bool($flip)) {
            $this->error("{$path}.flip", $id, 'Flip is true or false.');
            $valid = false;
        }

        return $valid ? ['shape' => $shape, 'color' => $color, 'height' => $height, 'flip' => $flip] : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function columns(mixed $columns, string $path, ?string $parentId, bool $inner): array
    {
        if (! is_array($columns) || ! array_is_list($columns) || count($columns) < 1 || count($columns) > self::MAX_COLUMNS) {
            $this->error($path, $parentId, 'A row needs 1 to '.self::MAX_COLUMNS.' columns.');

            return [];
        }

        $result = [];
        foreach ($columns as $i => $column) {
            $normalized = $this->column($column, "{$path}.{$i}", $inner);
            if ($normalized !== null) {
                $result[] = $normalized;
            }
        }

        return $result;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function column(mixed $node, string $path, bool $inner): ?array
    {
        if (! is_array($node)) {
            $this->error($path, null, 'A column must be an object.');

            return null;
        }
        $this->nodes++;
        $id = $this->id($node, $path);
        if (($node['type'] ?? 'column') !== 'column') {
            $this->error("{$path}.type", $id, 'The type of a column must be "column".');
        }

        $width = [];
        $raw = is_array($node['width'] ?? null) ? $node['width'] : [];
        foreach (['base', 'tablet', 'mobile'] as $breakpoint) {
            if (! array_key_exists($breakpoint, $raw) || ($breakpoint !== 'base' && $raw[$breakpoint] === null)) {
                if ($breakpoint === 'base') {
                    $this->error("{$path}.width.base", $id, 'A column needs a width.');
                }

                continue;
            }
            $value = $raw[$breakpoint];
            $rounded = is_int($value) || is_float($value) ? round((float) $value, 2) : null;
            if ($rounded === null || $rounded < self::COLUMN_WIDTH[0] || $rounded > self::COLUMN_WIDTH[1]) {
                $this->error("{$path}.width.{$breakpoint}", $id, 'A column width is a percentage from '.self::COLUMN_WIDTH[0].' to '.self::COLUMN_WIDTH[1].'.');

                continue;
            }
            $width[$breakpoint] = $rounded === floor($rounded) ? (int) $rounded : $rounded;
        }

        $elements = [];
        $raw = $node['elements'] ?? [];
        if (! is_array($raw) || ! array_is_list($raw)) {
            $this->error("{$path}.elements", $id, 'The elements must be a list.');
        } elseif (count($raw) > self::MAX_ELEMENTS_PER_COLUMN) {
            $this->error("{$path}.elements", $id, 'A column can hold at most '.self::MAX_ELEMENTS_PER_COLUMN.' elements.');
        } else {
            foreach ($raw as $i => $element) {
                $normalized = $this->element($element, "{$path}.elements.{$i}", $inner);
                if ($normalized !== null) {
                    $elements[] = $normalized;
                }
            }
        }

        return [
            'id' => $id,
            'type' => 'column',
            'width' => $width,
            'style' => StyleSchema::normalize($node['style'] ?? null),
            'elements' => $elements,
        ];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function element(mixed $node, string $path, bool $inInnerRow): ?array
    {
        if (! is_array($node)) {
            $this->error($path, null, 'An element must be an object.');

            return null;
        }
        $this->nodes++;
        $id = $this->id($node, $path);
        $type = $node['type'] ?? null;
        if (! ElementRegistry::exists($type)) {
            $this->error("{$path}.type", $id, 'Unknown element type.');

            return null;
        }
        if ($type === 'inner_row' && $inInnerRow) {
            $this->error("{$path}.type", $id, 'An inner row cannot contain another inner row.');

            return null;
        }
        if (! in_array($this->context, ElementRegistry::allowedIn($type), true)) {
            $noun = ['page' => 'this page', 'cms' => 'a content page', 'header' => 'the header', 'footer' => 'the footer', 'zone' => 'a shop area', 'popup' => 'a popup'][$this->context];
            $this->error("{$path}.type", $id, 'The '.ElementRegistry::label($type).' element cannot be used in '.$noun.'.', 'ELEMENT_NOT_ALLOWED');

            return null;
        }

        $props = $node['props'] ?? [];
        if (! is_array($props)) {
            $this->error("{$path}.props", $id, 'The props must be an object.');
            $props = [];
        }

        $props = $this->props($type, $props, "{$path}.props", $id);
        $result = [
            'id' => $id,
            'type' => $type,
            'props' => $props,
            // B6: list items' fields are translated with dot keys (`items.<item id>.title`); inner
            // rows may have a background video like sections.
            ...$this->common($node, $path, $id, ElementRegistry::translationFields($type, $props), $type === 'inner_row'),
        ];
        if (ElementRegistry::children($type) === 'columns') {
            $result['columns'] = $this->columns($node['columns'] ?? null, "{$path}.columns", $id, true);
        }

        return $result;
    }

    /**
     * visibility, hidden, schedule, translations — and style.
     *
     * @param  array<string, mixed>  $node
     * @param  array<string, int>  $translatable  field => max length
     * @param  bool  $backgroundVideo  B6: sections and inner rows may have a background video
     * @return array<string, mixed>
     */
    private function common(array $node, string $path, ?string $id, array $translatable, bool $backgroundVideo = false): array
    {
        $visibility = [];
        $raw = is_array($node['visibility'] ?? null) ? $node['visibility'] : [];
        foreach (self::DEVICES as $device) {
            $value = $raw[$device] ?? true;
            if (! is_bool($value)) {
                $this->error("{$path}.visibility.{$device}", $id, 'Visibility per device is true or false.');
                $value = true;
            }
            $visibility[$device] = $value;
        }

        $hidden = $node['hidden'] ?? false;
        if (! is_bool($hidden)) {
            $this->error("{$path}.hidden", $id, 'Hidden is true or false.');
            $hidden = false;
        }

        return [
            'style' => StyleSchema::normalize($node['style'] ?? null, $backgroundVideo),
            'visibility' => $visibility,
            'hidden' => $hidden,
            'schedule' => $this->schedule($node['schedule'] ?? null, "{$path}.schedule", $id),
            'translations' => $this->translations($node['translations'] ?? null, $translatable, "{$path}.translations", $id),
        ];
    }

    /**
     * @return array{starts_at: ?string, ends_at: ?string}|null
     */
    private function schedule(mixed $value, string $path, ?string $id): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            $this->error($path, $id, 'The schedule must be null or {starts_at, ends_at}.');

            return null;
        }

        $result = [];
        $instants = [];
        foreach (['starts_at', 'ends_at'] as $key) {
            $instant = $value[$key] ?? null;
            if ($instant === null) {
                $result[$key] = null;

                continue;
            }
            $parsed = is_string($instant) && preg_match(self::INSTANT, $instant) === 1 ? DateTimeImmutable::createFromFormat(DATE_ATOM, $this->atom($instant)) : false;
            if ($parsed === false) {
                $this->error("{$path}.{$key}", $id, 'Use an ISO 8601 date and time with a time zone, e.g. 2026-12-01T00:00:00+06:00.');
                $result[$key] = null;

                continue;
            }
            $result[$key] = $instant;
            $instants[$key] = $parsed;
        }

        if (isset($instants['starts_at'], $instants['ends_at']) && $instants['ends_at'] <= $instants['starts_at']) {
            $this->error("{$path}.ends_at", $id, 'The end of the schedule must be after its start.');
        }

        return $result['starts_at'] === null && $result['ends_at'] === null ? null : $result;
    }

    /**
     * An accepted instant in the exact DATE_ATOM shape (seconds, no fraction, ±hh:mm).
     */
    private function atom(string $instant): string
    {
        preg_match('/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/', $instant, $m);
        $zone = $m[3] === 'Z' ? '+00:00' : (strlen($m[3]) === 5 ? substr($m[3], 0, 3).':'.substr($m[3], 3) : $m[3]);

        return $m[1].($m[2] !== '' ? $m[2] : ':00').$zone;
    }

    /**
     * `{<locale>: {<field>: string}}` for the translatable locales and fields; blank values
     * and empty locales dropped.
     *
     * @param  array<string, int>  $fields
     * @return array<string, array<string, string>>
     */
    private function translations(mixed $value, array $fields, string $path, ?string $id): array
    {
        if ($value === null) {
            return [];
        }
        if (! is_array($value)) {
            $this->error($path, $id, 'The translations must be an object.');

            return [];
        }

        $result = [];
        foreach (LocaleContext::TRANSLATABLE as $locale) {
            if (! is_array($value[$locale] ?? null)) {
                continue;
            }
            $texts = [];
            foreach ($fields as $field => $max) {
                $text = $value[$locale][$field] ?? null;
                if ($text === null || (is_string($text) && trim($text) === '')) {
                    continue;
                }
                if (! is_string($text) || mb_strlen($text) > $max) {
                    $this->error("{$path}.{$locale}.{$field}", $id, "The translation must be text of at most {$max} characters.");

                    continue;
                }
                $texts[$field] = $text;
            }
            if ($texts !== []) {
                $result[$locale] = $texts;
            }
        }

        return $result;
    }

    private function id(array $node, string $path): ?string
    {
        $id = $node['id'] ?? null;
        if (! is_string($id) || preg_match('/'.self::ID_PATTERN.'/', $id) !== 1) {
            $this->error("{$path}.id", null, 'An id is 2–32 lower-case letters, digits, "_" or "-", starting with a letter.');

            return is_string($id) ? $id : null;
        }
        if (isset($this->ids[$id])) {
            $this->error("{$path}.id", $id, "The id \"{$id}\" is used more than once.");
        }
        $this->ids[$id] = true;

        return $id;
    }

    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    private function props(string $type, array $props, string $path, ?string $id): array
    {
        $defaults = ElementRegistry::defaults($type);
        $sectionType = ElementRegistry::sectionType($type);
        if ($sectionType !== null) {
            return $this->sectionProps($sectionType, $props, $path, $id);
        }
        if (in_array($type, ElementRegistry::B4, true)) {
            return $this->b4Props($type, $props, $path, $id);
        }
        if (in_array($type, ElementRegistry::B6, true)) {
            return (new B6ElementProps(fn (string $key, string $message) => $this->error("{$path}.{$key}", $id, $message)))->normalize($type, $props);
        }
        if (in_array($type, ElementRegistry::B8A, true)) {
            return (new B8ElementProps(fn (string $key, string $message) => $this->error("{$path}.{$key}", $id, $message)))->normalize($type, $props);
        }
        if (in_array($type, ElementRegistry::B8B, true)) {
            return (new B8ElementFormProps(fn (string $key, string $message) => $this->error("{$path}.{$key}", $id, $message)))->normalize($type, $props);
        }
        if (in_array($type, ElementRegistry::P2A, true)) {
            return (new P2ElementOrderFormProps(fn (string $key, string $message) => $this->error("{$path}.{$key}", $id, $message)))->normalize($type, $props);
        }

        // Optional texts (alt, html) may arrive as null (empty strings become null on input).
        $value = fn (string $key) => array_key_exists($key, $props)
            ? ($props[$key] === null && in_array($key, ['alt', 'html'], true) ? '' : $props[$key])
            : $defaults[$key];
        $check = function (string $key, bool $valid, string $message) use ($path, $id, $value, $defaults) {
            if ($valid) {
                return $value($key);
            }
            $this->error("{$path}.{$key}", $id, $message);

            return $defaults[$key];
        };
        $text = fn (string $key, int $min, int $max) => $check($key, is_string($value($key)) && mb_strlen(trim($value($key))) >= $min && mb_strlen($value($key)) <= $max, $min > 0 ? "Enter {$min} to {$max} characters." : "At most {$max} characters.");
        $enum = fn (string $key, array $allowed) => $check($key, in_array($value($key), $allowed, true), 'Choose one of: '.implode(', ', $allowed).'.');
        $int = fn (string $key, array $range) => $check($key, is_int($value($key)) && $value($key) >= $range[0] && $value($key) <= $range[1], "Enter a whole number from {$range[0]} to {$range[1]}.");

        return match ($type) {
            'heading' => [
                'text' => $text('text', 1, ElementRegistry::TEXT_LIMITS['heading.text']),
                'level' => $int('level', ElementRegistry::HEADING_LEVELS),
                'link' => $this->link($value('link'), false, "{$path}.link", $id),
            ],
            'text' => ['html' => $text('html', 0, ElementRegistry::TEXT_LIMITS['text.html'])],
            'image' => [
                'media_id' => $this->uuid($value('media_id'), true, "{$path}.media_id", $id),
                'alt' => $text('alt', 0, ElementRegistry::TEXT_LIMITS['image.alt']),
                'link' => $this->link($value('link'), false, "{$path}.link", $id),
                'aspect' => $enum('aspect', ElementRegistry::IMAGE_ASPECTS),
                'fit' => $enum('fit', ElementRegistry::IMAGE_FITS),
            ],
            'button' => [
                'label' => $text('label', 1, ElementRegistry::TEXT_LIMITS['button.label']),
                'link' => $this->link($value('link'), true, "{$path}.link", $id) ?? $defaults['link'],
                'variant' => $enum('variant', ElementRegistry::BUTTON_VARIANTS),
                'size' => $enum('size', ElementRegistry::BUTTON_SIZES),
                'full_width' => $check('full_width', is_bool($value('full_width')), 'Full width is true or false.'),
                ...$this->buttonAction($props['action'] ?? null, "{$path}.action", $id),
            ],
            'divider' => [
                'line' => $enum('line', ElementRegistry::DIVIDER_LINES),
                'thickness' => $int('thickness', ElementRegistry::DIVIDER_THICKNESS),
                'width' => $int('width', ElementRegistry::DIVIDER_WIDTH),
                'color' => StyleSchema::color($value('color')) ?? $check('color', false, 'Use #rrggbb, #rrggbbaa or a theme colour (theme:<role>).'),
                'align' => $enum('align', ElementRegistry::DIVIDER_ALIGNS),
            ],
            default => [],
        };
    }

    /**
     * B8b: a button's `action` — kept only when it is `dismiss` (closes the popup; popups only);
     * `link` (the default) is not stored, so older documents normalize unchanged.
     *
     * @return array{action?: string}
     */
    private function buttonAction(mixed $action, string $path, ?string $id): array
    {
        if ($action === null || $action === 'link') {
            return [];
        }
        if (! in_array($action, ElementRegistry::BUTTON_ACTIONS, true)) {
            $this->error($path, $id, 'Choose one of: '.implode(', ', ElementRegistry::BUTTON_ACTIONS).'.');

            return [];
        }
        if ($this->context !== 'popup') {
            $this->error($path, $id, 'Only a button inside a popup can close it.');

            return [];
        }

        return ['action' => $action];
    }

    /**
     * B4 elements' props (contract §2). Every key is present afterwards; optional texts may
     * arrive as null (stored as '' — or null for the props where null means "use the default").
     * A video stores the `provider` and `video_id` parsed from its URL; a countdown keeps only
     * the field of its source (`ends_at` for date, `promotion_id` for promotion; the other is
     * null). Ownership of referenced ids is checked by BuilderReferences.
     *
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    private function b4Props(string $type, array $props, string $path, ?string $id): array
    {
        $defaults = ElementRegistry::defaults($type);
        $raw = fn (string $key) => array_key_exists($key, $props) ? $props[$key] : $defaults[$key];
        $fail = function (string $key, string $message) use ($path, $id, $defaults) {
            $this->error("{$path}.{$key}", $id, $message);

            return $defaults[$key];
        };
        $text = function (string $key, int $min, int $max) use ($raw, $fail) {
            $value = $raw($key);
            if ($value === null && $min === 0) {
                return '';
            }
            if (is_string($value) && mb_strlen(trim($value)) >= $min && mb_strlen($value) <= $max) {
                return $value;
            }

            return $fail($key, $min > 0 ? "Enter {$min} to {$max} characters." : "At most {$max} characters.");
        };
        $nullableText = function (string $key, int $max) use ($raw, $fail) {
            $value = $raw($key);
            if ($value === null || (is_string($value) && trim($value) === '')) {
                return null;
            }

            return is_string($value) && mb_strlen($value) <= $max ? $value : $fail($key, "At most {$max} characters.");
        };
        $enum = fn (string $key, array $allowed) => in_array($raw($key), $allowed, true) ? $raw($key) : $fail($key, 'Choose one of: '.implode(', ', $allowed).'.');
        $int = fn (string $key, array $range) => is_int($raw($key)) && $raw($key) >= $range[0] && $raw($key) <= $range[1]
            ? $raw($key)
            : $fail($key, "Enter a whole number from {$range[0]} to {$range[1]}.");
        $bool = fn (string $key) => is_bool($raw($key)) ? $raw($key) : $fail($key, 'This setting is true or false.');
        $color = function (string $key) use ($raw, $fail) {
            $value = $raw($key);

            return $value === null ? null : (StyleSchema::color($value) ?? $fail($key, 'Use #rrggbb, #rrggbbaa or a theme colour (theme:<role>).'));
        };
        $link = fn (string $key, bool $required) => $this->link($raw($key), $required, "{$path}.{$key}", $id) ?? ($required ? $defaults[$key] : null);
        $uuid = function (string $key, string $message) use ($raw, $fail) {
            $value = $raw($key);

            return is_string($value) && preg_match(self::UUID, strtolower($value)) === 1 ? strtolower($value) : $fail($key, $message);
        };
        $button = function (string $key, bool $required) use ($raw, $path, $id, $defaults) {
            $value = $raw($key);
            if ($value === null && ! $required) {
                return null;
            }
            if (! is_array($value)) {
                $this->error("{$path}.{$key}", $id, 'A button needs a label and a link.');

                return $defaults[$key] ?? ['label' => 'Learn more', 'link' => ['url' => '/']];
            }
            $label = $value['label'] ?? null;
            if (! is_string($label) || trim($label) === '' || mb_strlen($label) > 60) {
                $this->error("{$path}.{$key}.label", $id, 'Enter 1 to 60 characters.');
                $label = 'Shop now';
            }

            return ['label' => $label, 'link' => $this->link($value['link'] ?? null, true, "{$path}.{$key}.link", $id) ?? ['url' => '/']];
        };

        return match ($type) {
            'video' => $this->videoProps($raw('url'), $path, $id) + [
                'title' => $text('title', 1, ElementRegistry::TRANSLATABLE['video']['title']),
                'aspect' => $enum('aspect', ElementRegistry::VIDEO_ASPECTS),
                'autoplay' => $bool('autoplay'),
                'start' => $int('start', ElementRegistry::VIDEO_START),
            ],
            'icon' => [
                'name' => $enum('name', ElementRegistry::ICONS),
                'size' => $int('size', ElementRegistry::ICON_SIZE),
                'color' => $color('color'),
                'label' => $text('label', 0, 120),
                'link' => $link('link', false),
            ],
            'countdown' => (function () use ($enum, $raw, $uuid, $text, $path, $id) {
                $source = $enum('source', ElementRegistry::COUNTDOWN_SOURCES);
                $endsAt = null;
                $promotionId = null;
                if ($source === 'promotion') {
                    $promotionId = $uuid('promotion_id', 'Choose a flash sale (a promotion with a countdown).');
                } elseif ($this->instant($raw('ends_at'))) {
                    $endsAt = $raw('ends_at');
                } else {
                    $this->error("{$path}.ends_at", $id, 'Choose when the countdown ends: an ISO 8601 date and time with a time zone, e.g. 2026-12-01T00:00:00+06:00.');
                }

                return [
                    'source' => $source,
                    'ends_at' => $endsAt,
                    'promotion_id' => $promotionId,
                    'title' => $text('title', 0, 120),
                    'expired_text' => $text('expired_text', 0, 200),
                    'style' => $enum('style', ElementRegistry::COUNTDOWN_STYLES),
                ];
            })(),
            'discount' => [
                'promotion_id' => $uuid('promotion_id', 'Choose a promotion.'),
                'title' => $text('title', 0, 120),
                'text' => $text('text', 0, 400),
                'show_code' => $bool('show_code'),
                'button_label' => $text('button_label', 0, 60),
                'link' => $link('link', false),
            ],
            'cta' => [
                'title' => $text('title', 1, 120),
                'text' => $text('text', 0, 400),
                'primary' => $button('primary', true),
                'secondary' => $button('secondary', false),
                'align' => $enum('align', ElementRegistry::ALIGNS),
            ],
            'search_box' => ['placeholder' => $text('placeholder', 0, 80), 'button_label' => $text('button_label', 0, 30)],
            'promo_card' => [
                'product_id' => $uuid('product_id', 'Choose a product.'),
                'badge' => $text('badge', 0, 24),
                'title' => $nullableText('title', 120),
                'text' => $text('text', 0, 200),
                'button_label' => $text('button_label', 0, 30),
            ],
            'logo' => ['height' => $int('height', ElementRegistry::LOGO_HEIGHT), 'link' => $link('link', true)],
            'menu' => [
                'menu_id' => $uuid('menu_id', 'Choose a menu.'),
                'layout' => $enum('layout', ElementRegistry::MENU_LAYOUTS),
                'show_children' => $enum('show_children', ElementRegistry::MENU_CHILDREN[$this->context] ?? ElementRegistry::MENU_CHILDREN['header']),
            ],
            'account_link', 'wishlist_link' => ['show_label' => $bool('show_label')],
            'cart_icon' => ['show_count' => $bool('show_count'), 'show_total' => $bool('show_total')],
            'language_switch' => ['style' => $enum('style', ElementRegistry::LANGUAGE_SWITCH_STYLES)],
            'social_icons' => [
                'size' => $int('size', ElementRegistry::SOCIAL_ICON_SIZE),
                'style' => $enum('style', ElementRegistry::SOCIAL_ICON_STYLES),
                'color' => $color('color'),
            ],
            'payment_icons' => ['height' => $int('height', ElementRegistry::PAYMENT_ICON_HEIGHT)],
            'contact_block' => [
                'show_phone' => $bool('show_phone'),
                'show_email' => $bool('show_email'),
                'show_address' => $bool('show_address'),
                'layout' => $enum('layout', ElementRegistry::BLOCK_LAYOUTS),
            ],
            'copyright' => ['text' => $nullableText('text', 200)],
            'newsletter_form' => [
                'title' => $text('title', 0, 120),
                'text' => $text('text', 0, 300),
                'button_label' => $text('button_label', 1, 40),
                'layout' => $enum('layout', ElementRegistry::BLOCK_LAYOUTS),
            ],
            'faq_list' => ['title' => $nullableText('title', 120), 'style' => $enum('style', ElementRegistry::FAQ_STYLES)],
            'contact_form' => ['title' => $nullableText('title', 120), 'show_details' => $bool('show_details')],
            'custom_html' => ['html' => $text('html', 1, ElementRegistry::CUSTOM_HTML_MAX)],
            // announcement: the theme's announcement, no props.
            default => [],
        };
    }

    /**
     * `{url, provider, video_id}` of a video element (an error when the URL is not supported).
     *
     * @return array{url: string, provider: string, video_id: string}
     */
    private function videoProps(mixed $url, string $path, ?string $id): array
    {
        $parsed = ElementRegistry::parseVideoUrl($url);
        if ($parsed === null) {
            $this->error("{$path}.url", $id, VideoUrl::INVALID_MESSAGE);
        }

        return [
            'url' => is_string($url) ? $url : '',
            'provider' => $parsed['provider'] ?? 'youtube',
            'video_id' => $parsed['video_id'] ?? '',
        ];
    }

    /**
     * An ISO 8601 instant with a time zone (as schedules accept).
     */
    private function instant(mixed $value): bool
    {
        return is_string($value) && preg_match(self::INSTANT, $value) === 1
            && DateTimeImmutable::createFromFormat(DATE_ATOM, $this->atom($value)) !== false;
    }

    /**
     * Props of a wrapped homepage section: title, subtitle, config (the homepage section's
     * rules and normalize()) and items (banners or hand-picked records, homepage limits).
     *
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    private function sectionProps(SectionType $type, array $props, string $path, ?string $id): array
    {
        $result = [];
        foreach (['title' => 120, 'subtitle' => 255] as $key => $max) {
            $value = $props[$key] ?? null;
            if (is_string($value) && trim($value) === '') {
                $value = null;
            }
            if ($value !== null && (! is_string($value) || mb_strlen($value) > $max)) {
                $this->error("{$path}.{$key}", $id, "At most {$max} characters.");
                $value = null;
            }
            $result[$key] = $value;
        }

        $config = $props['config'] ?? [];
        if (! is_array($config)) {
            $this->error("{$path}.config", $id, 'The config must be an object.');
            $config = [];
        }
        $rules = ['config' => [SectionConfigRules::requiresConfig($type) ? 'required' : 'present', 'array']] + SectionConfigRules::for($type);
        $validator = Validator::make(['config' => $config], $rules);
        if ($validator->fails()) {
            foreach ($validator->errors()->messages() as $attribute => $messages) {
                $this->error("{$path}.{$attribute}", $id, $messages[0]);
            }
        }
        $result['config'] = $type->normalize($config);
        $result['items'] = $this->items($type, $result['config'], $props['items'] ?? [], "{$path}.items", $id);

        return $result;
    }

    /**
     * @param  array<string, mixed>  $config  normalized
     * @return list<array{item_type: string, item_id: string}>
     */
    private function items(SectionType $type, array $config, mixed $items, string $path, ?string $id): array
    {
        if (! is_array($items) || ! array_is_list($items)) {
            $this->error($path, $id, 'The items must be a list.');

            return [];
        }

        $limits = ElementRegistry::itemLimits($type);
        if ($limits === null) {
            if ($items !== []) {
                $this->error($path, $id, 'This element takes no items.');
            }

            return [];
        }
        if ($limits['item_type'] !== 'banner' && ! $type->usesManualItems($config)) {
            // Hand-picked records only exist while the source is `manual` (like the homepage).
            return [];
        }
        if ($limits['item_type'] === 'banner') {
            $limits = [...$limits, ...$type->bannerLimits($config)];
        }

        $result = [];
        $seen = [];
        foreach ($items as $i => $item) {
            $itemId = is_array($item) && is_string($item['item_id'] ?? null) ? strtolower($item['item_id']) : null;
            if (! is_array($item) || ($item['item_type'] ?? null) !== $limits['item_type'] || $itemId === null || preg_match(self::UUID, $itemId) !== 1) {
                $this->error("{$path}.{$i}", $id, "Each item is {item_type: \"{$limits['item_type']}\", item_id: <uuid>}.");

                continue;
            }
            if (isset($seen[$itemId])) {
                $this->error("{$path}.{$i}.item_id", $id, 'An item is listed twice.');

                continue;
            }
            $seen[$itemId] = true;
            $result[] = ['item_type' => $limits['item_type'], 'item_id' => $itemId];
        }

        $noun = ['banner' => 'banners', 'product' => 'products', 'category' => 'categories', 'brand' => 'brands'][$limits['item_type']];
        if (count($items) < $limits['min'] || count($items) > $limits['max']) {
            $this->error($path, $id, $limits['min'] === $limits['max']
                ? "This element needs exactly {$limits['min']} {$noun}."
                : "Choose between {$limits['min']} and {$limits['max']} {$noun}.");
        }

        return $result;
    }

    /**
     * @return array{url: string}|null
     */
    private function link(mixed $value, bool $required, string $path, ?string $id): ?array
    {
        if ($value === null && ! $required) {
            return null;
        }
        $url = is_array($value) ? ($value['url'] ?? null) : null;
        if (! is_string($url) || ! LinkTarget::isSafe($url)) {
            $this->error(is_array($value) ? "{$path}.url" : $path, $id, 'The link must be a site path such as /sale or an http(s) URL.');

            return null;
        }

        return ['url' => $url];
    }

    private function uuid(mixed $value, bool $nullable, string $path, ?string $id): ?string
    {
        if ($value === null && $nullable) {
            return null;
        }
        if (! is_string($value) || preg_match(self::UUID, strtolower($value)) !== 1) {
            $this->error($path, $id, 'Choose an item from the media library.');

            return null;
        }

        return strtolower($value);
    }

    private function error(string $path, ?string $nodeId, string $message, ?string $code = null): void
    {
        if (count($this->errors) < self::MAX_ERRORS) {
            $this->errors[] = $this->entry($path, $nodeId, $message) + ($code === null ? [] : ['code' => $code]);
        }
    }

    /**
     * @return array{path: string, node_id: ?string, message: string}
     */
    private function entry(string $path, ?string $nodeId, string $message): array
    {
        return ['path' => $path, 'node_id' => $nodeId, 'message' => $message];
    }
}
