<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Storefront\Application\Queries\SectionContentResolver;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;
use stdClass;

/**
 * The render payload of a builder page (B1):
 * `{document: {id, key, title, version, source}, sections, media, data}`.
 *
 * - `sections`: the document tree with translatable props in the request's language
 *   (per-field fallback to the base text) and `translations` removed. Published content
 *   leaves out hidden nodes and nodes outside their schedule; the draft keeps them with
 *   `state: hidden | scheduled | expired`.
 * - `data[element_id]`: for every wrapped homepage-section element, exactly the object
 *   `/store/homepage` returns for such a section (SectionContentResolver, id = element id).
 *   An element whose content resolves empty is left out (draft: kept with `state: empty`).
 * - `media[media_id]`: `{url, srcset, width, height, alt}` for image elements and
 *   background images.
 * - B4: `data[element_id]` also for countdown, discount, promo_card, menu and faq_list elements
 *   (BuilderElementData); such an element without data is left out (draft: kept with
 *   `state: empty`, or its data carries `state: expired | inactive | unavailable`). Translatable
 *   B4 props are in the request's language too (`cta` button labels from the dot keys
 *   `primary.label` / `secondary.label`).
 * - B6: category_card, product_spotlight and shop_the_look have `data[id]` too
 *   (BuilderElementData); list items' texts are in the request's language (translation keys
 *   `<list>.<item id>.<field>`, chart labels `labels.<index>`); `media` also holds gallery,
 *   carousel and logo images, category card and shop-the-look photos and background-video
 *   posters. Published shop-the-look elements keep only the hotspots of products on sale.
 */
class BuilderPageRenderer
{
    public function __construct(
        private readonly SectionContentResolver $sections,
        private readonly MediaLibrary $media,
        private readonly LocaleContext $locale,
        private readonly BuilderElementData $elementData,
    ) {}

    /**
     * @param  array<string, mixed>  $content  normalized document
     * @param  'published'|'draft'  $source
     * @return array<string, mixed>
     */
    public function render(BuilderDocument $document, array $content, ?int $version, string $source): array
    {
        $preview = $source === 'draft';
        $now = CarbonImmutable::now();

        /** @var list<array<string, mixed>> $wrapped */
        $wrapped = [];
        /** @var list<array{id: string, type: string, props: array<string, mixed>}> $dataElements */
        $dataElements = [];
        $sections = [];
        foreach ($content['sections'] ?? [] as $section) {
            $node = $this->node($section, $preview, $now, $wrapped, $dataElements);
            if ($node !== null) {
                $sections[] = $node;
            }
        }

        $data = $this->sections->resolve($wrapped, $preview) + $this->elementData->resolve($dataElements, $preview);
        $sections = array_map(fn (array $section) => $this->withData($section, $data, $preview), $sections);
        if (! $preview) {
            // A section whose elements all dropped out (hidden, out of schedule, no content) would
            // render as an empty band; one the merchant left empty on purpose stays.
            $authored = [];
            foreach ($content['sections'] ?? [] as $section) {
                $authored[$section['id']] = self::elementCount($section);
            }
            $sections = array_values(array_filter($sections, fn (array $section) => ($authored[$section['id']] ?? 0) === 0 || self::elementCount($section) > 0));
        }

        $mediaIds = [];
        BuilderDocumentSchema::walk(['sections' => $sections], function (array $node) use (&$mediaIds) {
            array_push($mediaIds, ...StyleSchema::mediaIds($node['style'] ?? []));
            // Image elements; B6: galleries, carousels, logos, category cards and shop-the-look photos.
            if (is_string($node['type'] ?? null) && $node['type'] !== 'section' && $node['type'] !== 'column') {
                array_push($mediaIds, ...ElementRegistry::mediaIds($node['type'], $node['props'] ?? []));
            }
        });
        $media = [];
        foreach ($this->media->refs(array_values(array_unique($mediaIds))) as $id => $ref) {
            unset($ref['id']);
            $media[$id] = $ref;
        }

        return [
            'document' => [
                'id' => $document->id,
                'key' => $document->key,
                'title' => $document->title,
                'version' => $version,
                'source' => $source,
            ],
            'sections' => BuilderJson::present(['sections' => $sections])['sections'],
            'media' => $media === [] ? new stdClass : $media,
            'data' => $data === [] ? new stdClass : $data,
        ];
    }

    /**
     * The next instant a node of the content starts or stops being shown, if any.
     *
     * @param  array<string, mixed>  $content
     */
    public static function nextScheduleChange(array $content): ?CarbonImmutable
    {
        $now = CarbonImmutable::now();
        $next = null;
        BuilderDocumentSchema::walk($content, function (array $node) use ($now, &$next) {
            foreach (['starts_at', 'ends_at'] as $key) {
                $at = $node['schedule'][$key] ?? null;
                if (is_string($at) && ($instant = CarbonImmutable::parse($at))->gt($now) && ($next === null || $instant->lt($next))) {
                    $next = $instant;
                }
            }
        });

        return $next;
    }

    /**
     * The props of a basic or B4 element with its translatable props in `$locale` (per-field
     * fallback to the base text; B4: nested props such as `cta` button labels use dot keys).
     *
     * @param  array<string, mixed>  $props
     * @param  array<string, array<string, string>>  $translations
     * @return array<string, mixed>
     */
    public static function localizedProps(string $type, array $props, array $translations, string $locale): array
    {
        // B6: list items' fields too (`items.<item id>.title`, chart `labels.<index>`).
        foreach (array_keys(ElementRegistry::translationFields($type, $props)) as $field) {
            $target = ElementRegistry::translationTarget($type, $field, $props);
            if ($target === null) {
                continue;
            }
            switch (count($target)) {
                case 1:
                    $props[$field] = Translations::value($translations, $field, $locale, $props[$field] ?? null);
                    break;
                case 2:
                    if (is_array($props[$target[0]] ?? null) && array_key_exists($target[1], $props[$target[0]])) {
                        $props[$target[0]][$target[1]] = Translations::value($translations, $field, $locale, $props[$target[0]][$target[1]]);
                    }
                    break;
                default:
                    [$list, $index, $key] = $target;
                    $props[$list][$index][$key] = Translations::value($translations, $field, $locale, $props[$list][$index][$key] ?? null);
            }
        }

        return $props;
    }

    /**
     * `live`, `hidden`, `scheduled` (not started) or `expired`.
     *
     * @param  array<string, mixed>  $node
     */
    private function state(array $node, CarbonImmutable $now): string
    {
        $starts = $node['schedule']['starts_at'] ?? null;
        $ends = $node['schedule']['ends_at'] ?? null;

        return match (true) {
            ($node['hidden'] ?? false) === true => 'hidden',
            is_string($starts) && CarbonImmutable::parse($starts)->gt($now) => 'scheduled',
            is_string($ends) && CarbonImmutable::parse($ends)->lte($now) => 'expired',
            default => 'live',
        };
    }

    /**
     * A section or element for the render tree, or null when it is not shown.
     *
     * @param  array<string, mixed>  $node
     * @param  list<array<string, mixed>>  $wrapped  inputs of the section content resolver (collected)
     * @return array<string, mixed>|null
     */
    private function node(array $node, bool $preview, CarbonImmutable $now, array &$wrapped, array &$dataElements): ?array
    {
        $state = $this->state($node, $now);
        if ($state !== 'live' && ! $preview) {
            return null;
        }

        $translations = $node['translations'] ?? [];
        unset($node['translations']);
        $locale = $this->locale->current();

        if ($node['type'] !== 'section') {
            $sectionType = ElementRegistry::sectionType($node['type']);
            if ($sectionType === null) {
                $node['props'] = self::localizedProps($node['type'], $node['props'], $translations, $locale);
                if (BuilderElementData::handles($node['type'])) {
                    $dataElements[] = ['id' => $node['id'], 'type' => $node['type'], 'props' => $node['props']];
                }
            } else {
                $wrapped[] = [
                    'id' => $node['id'],
                    'type' => $sectionType,
                    'title' => $node['props']['title'],
                    'subtitle' => $node['props']['subtitle'],
                    'config' => $node['props']['config'],
                    'items' => $node['props']['items'],
                    'translations' => $translations,
                    'state' => $state,
                ];
                foreach (['title', 'subtitle'] as $field) {
                    $node['props'][$field] = Translations::value($translations, $field, $locale, $node['props'][$field]);
                }
                foreach ($sectionType->translatableConfigFields() as $field) {
                    $node['props']['config'][$field] = Translations::value($translations, $field, $locale, $node['props']['config'][$field] ?? null);
                }
            }
        }
        if ($state !== 'live') {
            $node['state'] = $state;
        }

        if (isset($node['columns'])) {
            foreach ($node['columns'] as $c => $column) {
                $elements = [];
                foreach ($column['elements'] as $element) {
                    $rendered = $this->node($element, $preview, $now, $wrapped, $dataElements);
                    if ($rendered !== null) {
                        $elements[] = $rendered;
                    }
                }
                $node['columns'][$c]['elements'] = $elements;
            }
        }

        return $node;
    }

    /**
     * Elements in a section or inner row, counting the elements of nested inner rows.
     *
     * @param  array<string, mixed>  $node
     */
    private static function elementCount(array $node): int
    {
        $count = 0;
        foreach ($node['columns'] ?? [] as $column) {
            foreach ($column['elements'] ?? [] as $element) {
                $count += isset($element['columns']) ? self::elementCount($element) : 1;
            }
        }

        return $count;
    }

    /**
     * Drops wrapped elements without content (published) or marks them `empty` (draft).
     *
     * @param  array<string, mixed>  $node
     * @param  array<string, array<string, mixed>>  $data
     * @return array<string, mixed>
     */
    private function withData(array $node, array $data, bool $preview): array
    {
        if (! isset($node['columns'])) {
            return $node;
        }
        foreach ($node['columns'] as $c => $column) {
            $elements = [];
            foreach ($column['elements'] as $element) {
                if (ElementRegistry::sectionType($element['type']) !== null) {
                    if (! isset($data[$element['id']])) {
                        continue;
                    }
                    if ($preview && ($data[$element['id']]['state'] ?? null) === 'empty') {
                        $element['state'] = 'empty';
                    }
                } elseif (BuilderElementData::handles($element['type']) && ! isset($data[$element['id']])) {
                    // B4: the record is gone or not shown (published: left out; draft: kept as empty).
                    if (! $preview) {
                        continue;
                    }
                    $element['state'] ??= 'empty';
                }
                if ($element['type'] === 'shop_the_look' && ! $preview && isset($data[$element['id']])) {
                    // B6: visitors only see the spots of products on sale.
                    $products = $data[$element['id']]['products'];
                    $element['props']['hotspots'] = array_values(array_filter($element['props']['hotspots'], fn (array $spot) => isset($products[$spot['product_id']])));
                }
                $elements[] = $this->withData($element, $data, $preview);
            }
            $node['columns'][$c]['elements'] = $elements;
        }

        return $node;
    }
}
