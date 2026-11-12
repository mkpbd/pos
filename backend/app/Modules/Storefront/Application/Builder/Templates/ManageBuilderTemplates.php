<?php

namespace App\Modules\Storefront\Application\Builder\Templates;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\PrepareBuilderContent;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Infrastructure\Models\BuilderTemplate;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * B5: the store builder's template library — the built-in templates (files, BuilderTemplateLibrary)
 * plus the organization's own saved sections (`builder_templates`, organization-scoped; another
 * organization's templates are invisible).
 *
 * Applying a template ("instantiate") returns ready-to-insert sections for one document context:
 * a built-in's portable references become the organization's own records (photos imported into
 * its media library, banners created, menus looked up — TemplateReferences), every node gets a
 * fresh id, and the result is validated like any draft content (`DOCUMENT_INVALID` otherwise).
 * Nothing is saved into a document: the editor inserts the sections into its draft and autosaves.
 * Own templates keep concrete references (the organization's own media and banners).
 */
class ManageBuilderTemplates
{
    public const MAX_ORGANIZATION_TEMPLATES = 100;

    /** Encoded size of an organization template's content. */
    public const MAX_BYTES = 262144;

    public const SAVED_CATEGORY = 'saved';

    public const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    public function __construct(
        private readonly BuilderTemplateLibrary $library,
        private readonly PrepareBuilderContent $prepare,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * Built-ins (manifest order) then the organization's own templates (newest first), filtered:
     * `scope` section | page | site, `preset` a preset key or `none`, `context` a document context
     * the template can be used in, `source` builtin | mine.
     *
     * @param  array{scope?: ?string, preset?: ?string, context?: ?string, source?: ?string}  $filters
     * @return list<array<string, mixed>>
     */
    public function list(array $filters = []): array
    {
        $builtIn = array_map(fn (array $t) => [
            'id' => $t['id'],
            'scope' => $t['scope'],
            'preset' => $t['preset'],
            'category' => $t['category'],
            'name' => $t['name'],
            'description' => $t['description'],
            'thumbnail_url' => $t['thumbnail'],
            // B7: the tall full-page preview of a site template (null for the others).
            'preview_url' => $t['preview'],
            'allowed_in' => $t['allowed_in'],
            'requires' => $t['requires'],
            'source' => 'builtin',
            'created_at' => null,
        ], $this->library->all());

        $own = BuilderTemplate::query()->orderByDesc('created_at')->orderBy('id')->get()
            ->map(fn (BuilderTemplate $t) => $this->summary($t))->all();

        return array_values(array_filter([...$builtIn, ...$own], function (array $t) use ($filters) {
            $preset = $filters['preset'] ?? null;

            return (($filters['scope'] ?? null) === null || $t['scope'] === $filters['scope'])
                && ($preset === null || $t['preset'] === ($preset === 'none' ? null : $preset))
                && (($filters['context'] ?? null) === null || in_array($filters['context'], $t['allowed_in'], true))
                && (($filters['source'] ?? null) === null || $t['source'] === $filters['source']);
        }));
    }

    /**
     * The template's sections for a document context, ready to insert into a draft:
     * `{template: {id, name, scope, source}, context, nodes: Section[], imported: {media, banners,
     * banners_reused}}`. Unknown (or another organization's) template: 404; a context the template
     * is not made for: 422 TEMPLATE_NOT_ALLOWED. Audited (`storefront.builder_template_used`).
     *
     * @return array<string, mixed>
     */
    public function instantiate(string $id, string $context): array
    {
        $own = preg_match(self::UUID, strtolower($id)) === 1;
        $template = $own ? BuilderTemplate::query()->find(strtolower($id)) : $this->library->find($id);
        if ($template === null) {
            throw (new ModelNotFoundException)->setModel(BuilderTemplate::class, [$id]);
        }
        $meta = $own ? $this->summary($template) : $template;
        if (! in_array($context, $meta['allowed_in'], true)) {
            throw new BusinessRuleViolation('TEMPLATE_NOT_ALLOWED', 'This template cannot be used here.', ['context' => $context, 'allowed_in' => $meta['allowed_in']]);
        }

        return DB::transaction(function () use ($own, $template, $meta, $context) {
            /** @var TemplateReferences $references */
            $references = app(TemplateReferences::class);
            $portable = $own ? [$template->content['section'] ?? []] : $this->library->sections($meta['id'], $context);
            $sections = PortableTemplate::concrete($portable, $references, $this->idGenerator());
            $document = ($this->prepare)(['schema_version' => BuilderDocumentSchema::SCHEMA_VERSION, 'sections' => $sections], $context);
            $imported = $references->summary();

            $this->audit->record('storefront.builder_template_used', $own ? $template : null, [], [
                'template_id' => $meta['id'],
                'source' => $meta['source'] ?? 'builtin',
                'context' => $context,
                'sections' => count($document['sections']),
            ] + $imported);

            return [
                'template' => ['id' => $meta['id'], 'name' => $meta['name'], 'scope' => $meta['scope'], 'source' => $own ? 'mine' : 'builtin'],
                'context' => $context,
                'nodes' => BuilderJson::present($document)['sections'],
                'imported' => $imported,
            ];
        });
    }

    /**
     * Saves a section as an organization template. The section is validated (and sanitized,
     * references checked) in `context`; the contexts it is valid in become its `allowed_in`.
     * At most 100 per organization (422 TEMPLATE_LIMIT_REACHED) and 256 KB each (422
     * TEMPLATE_TOO_LARGE). Audited.
     *
     * @param  array{name: string, description?: ?string, context: string, section: array<string, mixed>}  $attributes  validated
     */
    public function save(array $attributes): BuilderTemplate
    {
        $context = $attributes['context'];
        $document = ($this->prepare)(['schema_version' => BuilderDocumentSchema::SCHEMA_VERSION, 'sections' => [$attributes['section']]], $context);
        $allowed = array_values(array_filter(ElementRegistry::CONTEXTS, function (string $candidate) use ($document, $context) {
            if ($candidate === $context) {
                return true;
            }
            try {
                BuilderDocumentSchema::normalize($document, $candidate);

                return true;
            } catch (InvalidBuilderDocument) {
                return false;
            }
        }));
        $description = trim((string) ($attributes['description'] ?? ''));
        $content = [
            'description' => $description === '' ? null : $description,
            'context' => $context,
            'allowed_in' => $allowed,
            'section' => $document['sections'][0],
        ];
        $size = strlen((string) json_encode($content, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        if ($size > self::MAX_BYTES) {
            throw new BusinessRuleViolation('TEMPLATE_TOO_LARGE', 'This section is too large to save as a template ('.$size.' bytes; at most '.self::MAX_BYTES.').');
        }

        return DB::transaction(function () use ($attributes, $content) {
            // Serialize concurrent saves of the organization so the limit holds.
            BuilderTemplate::query()->lockForUpdate()->pluck('id');
            if (BuilderTemplate::query()->count() >= self::MAX_ORGANIZATION_TEMPLATES) {
                throw new BusinessRuleViolation('TEMPLATE_LIMIT_REACHED', 'You can save at most '.self::MAX_ORGANIZATION_TEMPLATES.' templates. Delete one you no longer need first.');
            }

            $template = BuilderTemplate::query()->create([
                'scope' => 'section',
                'preset' => null,
                'name' => trim($attributes['name']),
                'thumbnail_media_id' => null,
                'content' => $content,
            ]);
            $this->audit->record('storefront.builder_template_saved', $template, [], ['name' => $template->name, 'context' => $content['context']]);

            return $template;
        });
    }

    public function delete(BuilderTemplate $template): void
    {
        DB::transaction(function () use ($template) {
            $template->delete();
            $this->audit->record('storefront.builder_template_deleted', $template, ['name' => $template->name]);
        });
    }

    /**
     * An organization template as listed.
     *
     * @return array<string, mixed>
     */
    public function summary(BuilderTemplate $template): array
    {
        return [
            'id' => $template->id,
            'scope' => $template->scope,
            'preset' => $template->preset,
            'category' => self::SAVED_CATEGORY,
            'name' => $template->name,
            'description' => $template->content['description'] ?? null,
            'thumbnail_url' => null,
            'preview_url' => null,
            'allowed_in' => $template->content['allowed_in'] ?? [$template->content['context'] ?? 'page'],
            'requires' => [],
            'source' => 'mine',
            'created_at' => $template->created_at?->toIso8601String(),
        ];
    }

    /**
     * Fresh node ids (`s_`, `c_`, `e_` + 10 random characters), unique within one apply.
     *
     * @return callable(string): string
     */
    private function idGenerator(): callable
    {
        $used = [];

        return function (string $prefix) use (&$used): string {
            do {
                $id = $prefix.'_'.Str::lower(Str::random(10));
            } while (isset($used[$id]));
            $used[$id] = true;

            return $id;
        };
    }
}
