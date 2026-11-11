<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Storefront\Application\Queries\SectionContentResolver;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use stdClass;

/**
 * Canvas data for elements the editor has not saved yet (B2): each wrapped-section element is
 * validated on its own with the draft-save rules (schema + section config rules, sanitized,
 * references owned by the organization) and, when valid, resolved to exactly the object the
 * draft render gives it (SectionContentResolver, preview mode, with `state`). Invalid elements
 * only produce problems — one bad element never fails the others. Media ids resolve to
 * `{url, srcset, width, height, alt}`; ids the organization does not own are reported like
 * missing ones and never resolved.
 *
 * Problems are `{path, message, code?, ids?}` with the path relative to the element node
 * (e.g. `props.config.limit`, `props.items`, `translations.bn.title`).
 */
class ResolveBuilderElements
{
    /** Element paths inside the single-element document an element is validated in. */
    private const PREFIX = '/^sections\.\d+\.columns\.0\.elements\.0(\.|$)/';

    public function __construct(
        private readonly PrepareBuilderContent $prepare,
        private readonly BuilderReferences $references,
        private readonly SectionContentResolver $sections,
        private readonly MediaLibrary $media,
        private readonly BuilderPreviewLocale $locale,
    ) {}

    /**
     * @param  list<array<string, mixed>>  $elements  `{id, type, title?, subtitle?, config?, items?, translations?}` (ids distinct)
     * @param  list<string>  $mediaIds
     * @return array{data: array<string, array<string, mixed>>|stdClass, media: array<string, array<string, mixed>>|stdClass, errors: array<string, list<array<string, mixed>>>|stdClass}
     */
    public function __invoke(array $elements, array $mediaIds, mixed $locale): array
    {
        return $this->locale->using($locale, fn () => $this->resolve($elements, $mediaIds));
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @param  list<string>  $mediaIds
     * @return array{data: array<string, array<string, mixed>>|stdClass, media: array<string, array<string, mixed>>|stdClass, errors: array<string, list<array<string, mixed>>>|stdClass}
     */
    private function resolve(array $elements, array $mediaIds): array
    {
        /** @var array<string, list<array<string, mixed>>> $errors */
        $errors = [];
        /** @var array<string, array<string, mixed>> $valid element id => normalized element */
        $valid = [];

        foreach ($elements as $element) {
            $id = (string) $element['id'];
            $type = $element['type'] ?? null;
            if (! is_string($type) || ElementRegistry::sectionType($type) === null) {
                $errors[$id] = [['path' => 'type', 'message' => 'Only section elements (product grids, banners, newsletters, …) need resolving.']];

                continue;
            }
            try {
                $document = $this->prepare->sanitized($this->wrap([
                    'id' => $id,
                    'type' => $type,
                    'props' => [
                        'title' => $element['title'] ?? null,
                        'subtitle' => $element['subtitle'] ?? null,
                        'config' => $element['config'] ?? [],
                        'items' => $element['items'] ?? [],
                    ],
                    'translations' => $element['translations'] ?? [],
                ]));
                $valid[$id] = $document['sections'][0]['columns'][0]['elements'][0];
            } catch (InvalidBuilderDocument $e) {
                $errors[$id] = $this->problems($e->errors);
            }
        }

        if ($valid !== []) {
            // References of every valid element in one pass (a query per kind, not per element).
            try {
                $this->references->check(['sections' => array_map(fn (array $element) => [
                    'id' => 'resolve-s',
                    'columns' => [['id' => 'resolve-c', 'elements' => [$element]]],
                ], array_values($valid))]);
            } catch (InvalidBuilderDocument $e) {
                foreach ($e->errors as $error) {
                    $nodeId = $error['node_id'] ?? null;
                    if (is_string($nodeId) && isset($valid[$nodeId])) {
                        $errors[$nodeId] = [...($errors[$nodeId] ?? []), ...$this->problems([$error])];
                    }
                }
                $valid = array_diff_key($valid, $errors);
                // Problems in request order.
                $ordered = [];
                foreach ($elements as $element) {
                    if (isset($errors[(string) $element['id']])) {
                        $ordered[(string) $element['id']] = $errors[(string) $element['id']];
                    }
                }
                $errors = $ordered;
            }
        }

        $data = $this->sections->resolve(array_values(array_map(fn (array $element) => [
            'id' => $element['id'],
            'type' => ElementRegistry::sectionType($element['type']),
            'title' => $element['props']['title'],
            'subtitle' => $element['props']['subtitle'],
            'config' => $element['props']['config'],
            'items' => $element['props']['items'],
            'translations' => $element['translations'],
            'state' => 'live',
        ], $valid)), true);

        $mediaIds = array_values(array_unique(array_map('strtolower', $mediaIds)));
        $media = [];
        foreach ($this->media->refs($mediaIds) as $id => $ref) {
            unset($ref['id']);
            $media[$id] = $ref;
        }
        foreach ($mediaIds as $id) {
            if (! isset($media[$id])) {
                $errors[$id] = [['path' => 'media_id', 'message' => 'This image no longer exists in the media library.', 'code' => 'MEDIA_NOT_FOUND', 'ids' => [$id]]];
            }
        }

        return [
            'data' => $data === [] ? new stdClass : $data,
            'media' => $media === [] ? new stdClass : $media,
            'errors' => $errors === [] ? new stdClass : $errors,
        ];
    }

    /**
     * A one-section, one-column document holding the element.
     *
     * @param  array<string, mixed>  $element
     * @return array<string, mixed>
     */
    private function wrap(array $element): array
    {
        // The wrapper's ids must not collide with the element's.
        $section = $element['id'] === 'resolve-s' ? 'resolve-t' : 'resolve-s';
        $column = $element['id'] === 'resolve-c' ? 'resolve-d' : 'resolve-c';

        return ['schema_version' => 1, 'sections' => [[
            'id' => $section,
            'type' => 'section',
            'columns' => [['id' => $column, 'width' => ['base' => 100], 'elements' => [$element]]],
        ]]];
    }

    /**
     * Document problems as element problems: paths relative to the element.
     *
     * @param  list<array<string, mixed>>  $errors
     * @return list<array<string, mixed>>
     */
    private function problems(array $errors): array
    {
        return array_map(function (array $error) {
            $problem = [
                'path' => (string) preg_replace(self::PREFIX, '', (string) $error['path']),
                'message' => $error['message'],
            ];
            if (isset($error['code'])) {
                $problem['code'] = $error['code'];
            }
            if (isset($error['ids'])) {
                $problem['ids'] = $error['ids'];
            }

            return $problem;
        }, $errors);
    }
}
