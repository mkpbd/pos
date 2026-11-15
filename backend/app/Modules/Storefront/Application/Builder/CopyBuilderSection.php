<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\DeviceOrder;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * B12: copies one section (or a global section reference) to the top or the bottom of the drafts
 * of several documents — like a paste in each: new ids for the section and everything in it, no
 * anchor, no popup-only button action, no second sticky section, validated, sanitized and
 * reference-checked in the target's context (allowed elements, global sections that fit, limits).
 * One transaction per document (a failure leaves the others copied); drafts only, never
 * published; each copy audited. Custom HTML needs storefront.custom_html for the whole request.
 */
class CopyBuilderSection
{
    public const MAX_DOCUMENTS = 20;

    public const POSITIONS = ['top', 'bottom'];

    public function __construct(
        private readonly PrepareBuilderContent $prepare,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $section  a section node or a global section reference
     * @param  list<string>  $documentIds
     * @param  'top'|'bottom'  $position
     * @return list<array<string, mixed>> `{document_id, title, status: copied|failed, section_id?, revision?, error?}` per id
     */
    public function __invoke(array $section, array $documentIds, string $position, bool $mayEditCustomHtml): array
    {
        if (! $mayEditCustomHtml) {
            $this->assertNoCustomHtml($section);
        }
        $ids = array_map('strtolower', $documentIds);
        $documents = BuilderDocument::query()->builder()->whereIn('id', $ids)->get()->keyBy('id');

        $results = [];
        foreach ($ids as $id) {
            /** @var BuilderDocument|null $document */
            $document = $documents->get($id);
            if ($document === null) {
                $results[] = $this->failed($id, null, 'DOCUMENT_NOT_FOUND', 'This page no longer exists.');

                continue;
            }
            if ($document->isPopup() || $document->isGlobal()) {
                $results[] = $this->failed($id, $document->title, 'TARGET_NOT_SUPPORTED', $document->isPopup()
                    ? 'Sections can’t be copied into popups and bars.'
                    : 'A global section holds just one section.');

                continue;
            }
            try {
                $results[] = DB::transaction(fn () => $this->copyInto($document, $section, $position));
            } catch (InvalidBuilderDocument $e) {
                $results[] = $this->failed($id, $document->title, 'DOCUMENT_INVALID', $e->errors[0]['message'] ?? $e->getMessage(), $e->errors);
            } catch (BusinessRuleViolation $e) {
                $results[] = $this->failed($id, $document->title, $e->errorCode, $e->getMessage());
            }
        }

        return $results;
    }

    /**
     * @param  array<string, mixed>  $section
     * @return array<string, mixed>
     */
    private function copyInto(BuilderDocument $document, array $section, string $position): array
    {
        $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
        $content = $locked->draft;
        $context = $locked->contentContext();

        $existing = [];
        BuilderDocumentSchema::walk($content, function (array $node) use (&$existing) {
            $existing[$node['id']] = true;
        });
        $copy = $this->freshIds($section, $existing);
        if (is_array($copy['props'] ?? null)) {
            $copy['props']['anchor'] = null;
            if (($copy['props']['sticky'] ?? false) === true && (! in_array($context, BuilderDocumentSchema::STICKY_CONTEXTS, true) || $this->hasSticky($content))) {
                unset($copy['props']['sticky']);
            }
        }
        $copy = $this->withoutDismiss($copy);

        $sections = is_array($content['sections'] ?? null) ? array_values($content['sections']) : [];
        if ($position === 'top') {
            array_unshift($sections, $copy);
            // An own order on tablets / phones puts it first there too (bottom: appended by normalize).
            foreach (DeviceOrder::DEVICES as $device) {
                if (is_array($content['device_order'][$device][DeviceOrder::ROOT] ?? null)) {
                    array_unshift($content['device_order'][$device][DeviceOrder::ROOT], $copy['id']);
                }
            }
        } else {
            $sections[] = $copy;
        }
        $content['sections'] = $sections;
        $content = ($this->prepare)($content, $context);

        $locked->draft = $content;
        $locked->draft_revision++;
        $locked->draft_updated_at = CarbonImmutable::now();
        $locked->draft_updated_by = StaffActor::id();
        $locked->save();
        $this->audit->record('storefront.builder_section_copied', $locked, [], [
            'section_id' => $copy['id'],
            'position' => $position,
            'draft_revision' => $locked->draft_revision,
        ], ['source_section_id' => is_string($section['id'] ?? null) ? $section['id'] : null]);

        return [
            'document_id' => $locked->id,
            'title' => $locked->title,
            'status' => 'copied',
            'section_id' => $copy['id'],
            'revision' => $locked->draft_revision,
        ];
    }

    /**
     * New ids for a node and everything in it (the id's prefix kept), unique in `$existing`.
     *
     * @param  array<string, mixed>  $node
     * @param  array<string, true>  $existing
     * @return array<string, mixed>
     */
    private function freshIds(array $node, array &$existing): array
    {
        $type = $node['type'] ?? null;
        $fallback = match ($type) {
            'section', BuilderDocumentSchema::GLOBAL_SECTION => 's',
            'column' => 'c',
            default => 'e',
        };
        $prefix = is_string($node['id'] ?? null) && preg_match('/^([a-z][a-z0-9]*)_/', $node['id'], $m) === 1 ? substr($m[1], 0, 20) : $fallback;
        do {
            $id = $prefix.'_'.Str::lower(Str::random(6));
        } while (isset($existing[$id]));
        $existing[$id] = true;
        $node['id'] = $id;

        foreach (['columns', 'elements'] as $key) {
            if (is_array($node[$key] ?? null) && array_is_list($node[$key])) {
                $node[$key] = array_map(fn ($child) => is_array($child) ? $this->freshIds($child, $existing) : $child, $node[$key]);
            }
        }

        return $node;
    }

    /**
     * A popup-only "close" button links again outside a popup (sections never go into popups here).
     *
     * @param  array<string, mixed>  $node
     * @return array<string, mixed>
     */
    private function withoutDismiss(array $node): array
    {
        if (($node['type'] ?? null) === 'button' && is_array($node['props'] ?? null) && ($node['props']['action'] ?? null) === 'dismiss') {
            unset($node['props']['action']);
        }
        foreach (['columns', 'elements'] as $key) {
            if (is_array($node[$key] ?? null) && array_is_list($node[$key])) {
                $node[$key] = array_map(fn ($child) => is_array($child) ? $this->withoutDismiss($child) : $child, $node[$key]);
            }
        }

        return $node;
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function hasSticky(array $content): bool
    {
        foreach ($content['sections'] ?? [] as $section) {
            if (is_array($section) && ($section['props']['sticky'] ?? false) === true) {
                return true;
            }
        }

        return false;
    }

    /**
     * 403 CUSTOM_HTML_FORBIDDEN when the copy holds custom HTML (nothing is copied).
     *
     * @param  array<string, mixed>  $section
     */
    private function assertNoCustomHtml(array $section): void
    {
        $errors = [];
        $visit = function (array $node, string $path) use (&$visit, &$errors) {
            if (($node['type'] ?? null) === 'custom_html') {
                $errors[] = [
                    'path' => $path,
                    'node_id' => is_string($node['id'] ?? null) ? $node['id'] : null,
                    'message' => 'Adding custom HTML needs the "Edit custom HTML" permission.',
                    'code' => 'CUSTOM_HTML_FORBIDDEN',
                ];
            }
            foreach (['columns', 'elements'] as $key) {
                if (is_array($node[$key] ?? null)) {
                    foreach ($node[$key] as $i => $child) {
                        if (is_array($child)) {
                            $visit($child, "{$path}.{$key}.{$i}");
                        }
                    }
                }
            }
        };
        $visit($section, 'section');

        if ($errors !== []) {
            throw new BusinessRuleViolation('CUSTOM_HTML_FORBIDDEN', 'The section holds custom HTML, and only people allowed to use custom HTML can add it.', ['errors' => $errors], 403);
        }
    }

    /**
     * @param  list<array<string, mixed>>|null  $errors
     * @return array<string, mixed>
     */
    private function failed(string $id, ?string $title, string $code, string $message, ?array $errors = null): array
    {
        return [
            'document_id' => $id,
            'title' => $title,
            'status' => 'failed',
            'error' => ['code' => $code, 'message' => $message] + ($errors === null ? [] : ['errors' => $errors]),
        ];
    }
}
