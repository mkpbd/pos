<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Marketing\Application\Contracts\PageInsightDocuments;
use App\Modules\Orders\Application\Contracts\OrderPageAttribution;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Experiments;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use Illuminate\Support\Facades\Cache;

/**
 * B15: the builder documents page insights are collected for (Marketing) and orders are
 * attributed to (Orders) — pages, the header, the footer and shop areas of the tenant's store
 * (not popups, global sections or the theme draft). Only top-level sections are tracked; a
 * global section reference keeps its own node id on the storefront (BuilderGlobals), so the ids
 * are those of the document's own content. A version's section ids are cached (versions never
 * change).
 */
class BuilderInsightDocuments implements OrderPageAttribution, PageInsightDocuments
{
    public const KINDS = [BuilderDocument::KIND_PAGE, BuilderDocument::KIND_HEADER, BuilderDocument::KIND_FOOTER, BuilderDocument::KIND_ZONE];

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function trackableSections(string $documentId, int $version): ?array
    {
        $document = $this->find($documentId);
        if ($document === null || $document->published_version_id === null || $version < 1) {
            return null;
        }
        /** @var array{id: string, nodes: list<string>}|null $cached */
        $cached = Cache::remember('builder-insights:sections:'.$document->id.':'.$version, now()->addDay(), function () use ($document, $version) {
            $row = BuilderVersion::query()->publishedOnly()->where('document_id', $document->id)->where('number', $version)->first(['id', 'content']);

            return $row === null ? null : ['id' => $row->id, 'nodes' => array_column($this->sections($row->content), 'node_id')];
        });

        return $cached['nodes'] ?? null;
    }

    public function describe(string $documentId): ?array
    {
        $document = $this->find($documentId);
        if ($document === null) {
            return null;
        }
        $versions = BuilderVersion::query()->publishedOnly()->where('document_id', $document->id)->orderBy('number')
            ->get(['id', 'number', 'published_at', 'content']);
        $live = $versions->firstWhere('id', $document->published_version_id);
        $sections = $live === null ? [] : $this->sections($live->content);
        $draft = $this->sections($document->draft);

        // B9: a global section reference is labelled with the global's title.
        $globals = [];
        foreach ([...$sections, ...$draft] as $section) {
            if ($section['type'] === BuilderDocumentSchema::GLOBAL_SECTION && $section['label'] !== null) {
                $globals[] = $section['label'];
            }
        }
        $titles = $globals === [] ? [] : BuilderDocument::query()->where('kind', BuilderDocument::KIND_GLOBAL)
            ->whereIn('id', array_values(array_unique($globals)))->pluck('title', 'id')->all();
        $label = fn (array $section) => $section['type'] === BuilderDocumentSchema::GLOBAL_SECTION
            ? ['label' => $titles[$section['label']] ?? null] + $section
            : $section;

        return [
            'id' => $document->id,
            'title' => $document->title,
            'kind' => $document->kind,
            'key' => $document->key,
            'sections' => array_map($label, $sections),
            'draft_sections' => array_map($label, $draft),
            'versions' => $versions->map(fn (BuilderVersion $v) => [
                'number' => (int) $v->number,
                'published_at' => $v->published_at?->toIso8601String(),
            ])->values()->all(),
        ];
    }

    public function existing(array $documentIds): array
    {
        $ids = array_values(array_filter(array_map('strtolower', $documentIds), fn (string $id) => preg_match(self::UUID, $id) === 1));
        if ($ids === []) {
            return [];
        }

        return BuilderDocument::query()->whereIn('kind', self::KINDS)->whereIn('id', $ids)->pluck('id')->all();
    }

    public function runningExperiments(string $documentId, int $version): array
    {
        $document = $this->find($documentId);
        if ($document === null || $document->published_version_id === null || $version < 1) {
            return [];
        }

        // Versions never change, so neither do their tests.
        return Cache::remember('builder-insights:experiments:'.$document->id.':'.$version, now()->addDay(), function () use ($document, $version) {
            $content = BuilderVersion::query()->publishedOnly()->where('document_id', $document->id)->where('number', $version)->value('content');
            $content = is_string($content) ? json_decode($content, true) : $content;
            $running = [];
            foreach (is_array($content) ? ($content['experiments'] ?? []) : [] as $experiment) {
                if (is_array($experiment) && ($experiment['status'] ?? null) === 'running' && is_string($experiment['id'] ?? null)) {
                    $running[$experiment['id']] = Experiments::armSections($content, $experiment['id']);
                }
            }

            return $running;
        });
    }

    public function experiment(string $documentId, string $experimentId): ?array
    {
        $document = $this->find($documentId);
        if ($document === null) {
            return null;
        }
        foreach ([$document->draft, $document->publishedVersion?->content] as $content) {
            $found = is_array($content) ? Experiments::find($content, $experimentId) : null;
            if ($found !== null) {
                return $found[1];
            }
        }

        return null;
    }

    public function isStorePage(string $documentId): bool
    {
        return $this->find($documentId) !== null;
    }

    public function sectionOf(string $documentId, string $elementId): ?string
    {
        $document = $this->find($documentId);
        $content = $document?->publishedVersion?->content;
        if (! is_array($content)) {
            return null;
        }
        foreach ($content['sections'] ?? [] as $section) {
            if (! is_array($section) || ! is_string($section['id'] ?? null)) {
                continue;
            }
            $found = false;
            BuilderDocumentSchema::walk(['sections' => [$section]], function (array $node) use ($elementId, &$found) {
                $found = $found || ($node['id'] ?? null) === $elementId;
            });
            if ($found) {
                return $section['id'];
            }
        }

        return null;
    }

    private function find(string $documentId): ?BuilderDocument
    {
        $id = strtolower($documentId);
        if (preg_match(self::UUID, $id) !== 1) {
            return null;
        }

        return BuilderDocument::query()->whereIn('kind', self::KINDS)->whereKey($id)->first();
    }

    /**
     * The top-level sections of a content: `label` is the section's anchor (a global section
     * reference: the global's id, replaced by its title in describe()).
     *
     * @param  array<string, mixed>|null  $content
     * @return list<array{node_id: string, label: ?string, type: string}>
     */
    private function sections(?array $content): array
    {
        $result = [];
        foreach ($content['sections'] ?? [] as $section) {
            if (! is_array($section) || ! is_string($section['id'] ?? null)) {
                continue;
            }
            $global = ($section['type'] ?? 'section') === BuilderDocumentSchema::GLOBAL_SECTION;
            $label = $global ? ($section['ref'] ?? null) : ($section['props']['anchor'] ?? null);
            $result[] = [
                'node_id' => $section['id'],
                'label' => is_string($label) ? $label : null,
                'type' => $global ? BuilderDocumentSchema::GLOBAL_SECTION : 'section',
            ];
        }

        return $result;
    }
}
