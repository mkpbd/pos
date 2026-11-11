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
 */
class BuilderPageRenderer
{
    public function __construct(
        private readonly SectionContentResolver $sections,
        private readonly MediaLibrary $media,
        private readonly LocaleContext $locale,
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
        $sections = [];
        foreach ($content['sections'] ?? [] as $section) {
            $node = $this->node($section, $preview, $now, $wrapped);
            if ($node !== null) {
                $sections[] = $node;
            }
        }

        $data = $this->sections->resolve($wrapped, $preview);
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
            if (($node['type'] ?? null) === 'image' && is_string($node['props']['media_id'] ?? null)) {
                $mediaIds[] = $node['props']['media_id'];
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
    private function node(array $node, bool $preview, CarbonImmutable $now, array &$wrapped): ?array
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
                foreach (array_keys(ElementRegistry::translatable($node['type'])) as $field) {
                    $node['props'][$field] = Translations::value($translations, $field, $locale, $node['props'][$field]);
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
                    $rendered = $this->node($element, $preview, $now, $wrapped);
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
                }
                $elements[] = $this->withData($element, $data, $preview);
            }
            $node['columns'][$c]['elements'] = $elements;
        }

        return $node;
    }
}
