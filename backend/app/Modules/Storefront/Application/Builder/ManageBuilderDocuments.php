<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\Templates\ManageBuilderTemplates;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Store builder documents (B1): create (blank or from the current homepage), save the draft
 * with optimistic concurrency, publish (a new immutable version), discard the draft, restore
 * a version into the draft, delete a landing page, rename (B2). Publishing, discarding,
 * restoring, deleting and renaming are audited; what shoppers see changes only on publish (and deleting a published
 * landing page), which bumps the storefront content version through the model.
 */
class ManageBuilderDocuments
{
    public function __construct(
        private readonly PrepareBuilderContent $prepare,
        private readonly HomepageImporter $importer,
        private readonly AuditTrail $audit,
        private readonly CmsPageImporter $cmsImporter,
        private readonly SitePartsImporter $siteParts,
        private readonly PageContent $cmsPages,
        private readonly ManageBuilderTemplates $templates,
        private readonly StorefrontCatalog $catalog,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * B4: `kind` page (home, landing:<slug>, cms:<page id>), header, footer or zone; `from`:
     * blank, homepage (home), cms (a CMS page: its title, body and FAQ / contact form) or current
     * (header / footer: today's default layout). A CMS page must exist in the organization
     * (422 CMS_PAGE_NOT_FOUND otherwise — another organization's page included).
     *
     * B5: `$content` — a draft to start from instead of `from` (start from a demo; validated
     * here like any draft), recorded as `from` in the audit.
     *
     * @param  array{kind: string, key: string, title: string, from?: ?string}  $attributes  validated
     * @param  array<string, mixed>|null  $content
     */
    public function create(array $attributes, ?array $content = null): BuilderDocument
    {
        if (($attributes['kind'] ?? null) === BuilderDocument::KIND_POPUP) {
            return $this->createPopup($attributes['title'], $attributes['template'] ?? null);
        }
        $key = $attributes['key'];
        $context = BuilderDocumentSchema::contextOf($key);
        $pageId = str_starts_with($key, BuilderDocument::CMS_PREFIX) ? substr($key, strlen(BuilderDocument::CMS_PREFIX)) : null;
        $page = $pageId === null ? null : $this->cmsPages->find($pageId);
        if ($pageId !== null && $page === null) {
            throw new BusinessRuleViolation('CMS_PAGE_NOT_FOUND', 'This content page does not exist.', ['key' => $key]);
        }
        // P1b: a product zone's version for a category or a product of this organization.
        $target = BuilderDocument::parseTargetedZone($key);
        if ($target !== null && $this->catalog->existing($target['type'], [$target['id']]) === []) {
            throw new BusinessRuleViolation('ZONE_TARGET_NOT_FOUND', $target['type'] === BuilderDocument::TARGET_CATEGORY
                ? 'This category does not exist. Choose one of your categories.'
                : 'This product does not exist. Choose one of your products.', ['key' => $key, 'target_type' => $target['type'], 'target_id' => $target['id']]);
        }

        if (($attributes['from'] ?? null) === 'template' && $content === null) {
            // P2a: a new campaign page from a built-in page template (photos imported, product
            // references resolved to the chosen product), validated like any draft.
            $productId = is_string($attributes['product_id'] ?? null) ? strtolower($attributes['product_id']) : null;
            $content = $this->templates->pageContent((string) $attributes['template'], $productId)['content'];
        }
        $content = $content !== null ? ($this->prepare)($content, $context) : match ($attributes['from'] ?? 'blank') {
            'homepage' => ($this->prepare)($this->importer->document(), $context),
            'cms' => ($this->prepare)($this->cmsImporter->document($page), $context),
            'current' => ($this->prepare)($key === BuilderDocument::HEADER ? $this->siteParts->header() : $this->siteParts->footer(), $context),
            default => BuilderDocumentSchema::blank(),
        };

        return DB::transaction(function () use ($attributes, $content, $target) {
            if ($target !== null) {
                // P1b: counted under a per-organization lock, so two editors cannot both add the 101st version.
                $this->lockZoneVersions();
            }
            if (BuilderDocument::query()->where('key', $attributes['key'])->lockForUpdate()->exists()) {
                throw new BusinessRuleViolation('DOCUMENT_EXISTS', match (true) {
                    $attributes['key'] === BuilderDocument::HOME => 'The store already has a builder home page.',
                    $attributes['kind'] === BuilderDocument::KIND_HEADER => 'The store already has a builder header.',
                    $attributes['kind'] === BuilderDocument::KIND_FOOTER => 'The store already has a builder footer.',
                    $target !== null => $target['type'] === BuilderDocument::TARGET_CATEGORY
                        ? 'This area already has a version for this category.'
                        : 'This area already has a version for this product.',
                    $attributes['kind'] === BuilderDocument::KIND_ZONE => 'This area already has a builder design.',
                    str_starts_with($attributes['key'], BuilderDocument::CMS_PREFIX) => 'This content page is already designed with the builder.',
                    default => 'Another landing page already uses this address.',
                }, ['key' => $attributes['key']], 409);
            }
            if ($target !== null && $this->targetedZoneCount() >= BuilderDocument::MAX_TARGETED_ZONES) {
                throw new BusinessRuleViolation(
                    'ZONE_VERSION_LIMIT',
                    'Your store already has '.BuilderDocument::MAX_TARGETED_ZONES.' area versions for categories and products. Delete one you no longer need first.',
                    ['limit' => BuilderDocument::MAX_TARGETED_ZONES],
                );
            }

            $document = BuilderDocument::query()->create([
                'kind' => $attributes['kind'],
                'key' => $attributes['key'],
                'title' => $attributes['title'],
                'schema_version' => BuilderDocumentSchema::SCHEMA_VERSION,
                'draft' => $content,
                'draft_revision' => 0,
                'draft_updated_at' => CarbonImmutable::now(),
                'draft_updated_by' => StaffActor::id(),
            ]);
            $this->audit->record('storefront.builder_created', $document, [], [
                'key' => $document->key,
                'title' => $document->title,
                'from' => ($attributes['from'] ?? 'blank') === 'template' ? 'template:'.$attributes['template'] : ($attributes['from'] ?? 'blank'),
            ]);

            return $document;
        });
    }

    /**
     * B8b: a new popup (`popup:<uuid>`, switched off): blank with the default settings, or from a
     * built-in popup template (its photos imported and references resolved as when applying a
     * template). Audited like any new document (`from`: blank | template:<id>).
     */
    private function createPopup(string $title, ?string $template): BuilderDocument
    {
        $key = BuilderDocument::POPUP_PREFIX.strtolower((string) Str::uuid());

        return DB::transaction(function () use ($key, $title, $template) {
            $content = $template === null
                ? ($this->prepare)(BuilderDocumentSchema::blankPopup(), 'popup')
                : ($this->prepare)($this->templates->popupContent($template)['content'], 'popup');

            $document = BuilderDocument::query()->create([
                'kind' => BuilderDocument::KIND_POPUP,
                'key' => $key,
                'title' => $title,
                'schema_version' => BuilderDocumentSchema::SCHEMA_VERSION,
                'draft' => $content,
                'draft_revision' => 0,
                'draft_updated_at' => CarbonImmutable::now(),
                'draft_updated_by' => StaffActor::id(),
                'active' => false,
            ]);
            $this->audit->record('storefront.builder_created', $document, [], [
                'key' => $document->key,
                'title' => $document->title,
                'from' => $template === null ? 'blank' : 'template:'.$template,
            ]);

            return $document;
        });
    }

    /**
     * B8b: switches a popup on or off (not versioned; needs storefront.publish, checked by the
     * route). Only a published popup can be switched on (422 POPUP_NOT_PUBLISHED); other documents
     * 422 NOT_A_POPUP. Audited; a published popup's change refreshes the storefront cache.
     */
    public function setActive(BuilderDocument $document, bool $active): BuilderDocument
    {
        if (! $document->isPopup()) {
            throw new BusinessRuleViolation('NOT_A_POPUP', 'Only popups and bars can be switched on or off.');
        }

        return DB::transaction(function () use ($document, $active) {
            $locked = $this->lock($document);
            if ($locked->active === $active) {
                return $locked;
            }
            if ($active && $locked->published_version_id === null) {
                throw new BusinessRuleViolation('POPUP_NOT_PUBLISHED', 'Publish this popup before switching it on.');
            }
            $locked->active = $active;
            $locked->save();
            $this->audit->record($active ? 'storefront.builder_popup_activated' : 'storefront.builder_popup_deactivated', $locked, ['active' => ! $active], ['active' => $active]);

            return $locked;
        });
    }

    /**
     * Replaces the draft. `$revision` is the revision the editor started from; a newer one
     * (another tab or person saved meanwhile) is 409 DRAFT_CONFLICT with the current revision.
     *
     * B4: validated in the document's context (allowed elements); without `$mayEditCustomHtml`
     * (storefront.custom_html) a draft that adds a custom HTML element or changes one's HTML is
     * 403 CUSTOM_HTML_FORBIDDEN naming the nodes — moving, hiding, restyling and deleting
     * existing ones stays possible.
     *
     * @param  array<string, mixed>  $content
     */
    public function saveDraft(BuilderDocument $document, int $revision, array $content, bool $mayEditCustomHtml = true): BuilderDocument
    {
        $content = ($this->prepare)($content, BuilderDocumentSchema::contextOf($document->key));

        return DB::transaction(function () use ($document, $revision, $content, $mayEditCustomHtml) {
            $locked = $this->lock($document);
            if ($locked->draft_revision !== $revision) {
                throw new BusinessRuleViolation('DRAFT_CONFLICT', 'This page was changed elsewhere since you opened it. Reload it to continue.', ['revision' => $locked->draft_revision], 409);
            }
            if (! $mayEditCustomHtml) {
                $this->assertCustomHtmlUnchanged($locked->draft, $content);
            }

            return $this->writeDraft($locked, $content);
        });
    }

    /**
     * @param  array<string, mixed>  $before  the stored draft
     * @param  array<string, mixed>  $after  the prepared new draft
     */
    private function assertCustomHtmlUnchanged(array $before, array $after): void
    {
        $existing = [];
        BuilderDocumentSchema::walk($before, function (array $node, string $path, string $kind) use (&$existing) {
            if ($kind === 'element' && $node['type'] === 'custom_html') {
                $existing[$node['id']] = $node['props']['html'] ?? null;
            }
        });

        $errors = [];
        BuilderDocumentSchema::walk($after, function (array $node, string $path, string $kind) use ($existing, &$errors) {
            if ($kind !== 'element' || $node['type'] !== 'custom_html') {
                return;
            }
            $added = ! array_key_exists($node['id'], $existing);
            if ($added || $existing[$node['id']] !== $node['props']['html']) {
                $errors[] = [
                    'path' => $added ? $path : "{$path}.props.html",
                    'node_id' => $node['id'],
                    'message' => $added
                        ? 'Adding custom HTML needs the "Edit custom HTML" permission. You can still move, hide or delete existing custom HTML.'
                        : 'Changing custom HTML needs the "Edit custom HTML" permission. You can still move, hide or delete it.',
                    'code' => 'CUSTOM_HTML_FORBIDDEN',
                ];
            }
        });

        if ($errors !== []) {
            throw new BusinessRuleViolation('CUSTOM_HTML_FORBIDDEN', 'You may not add or change custom HTML.', ['errors' => $errors], 403);
        }
    }

    /**
     * B2: a new title (audited; an unchanged title is a no-op). The title of a published
     * page is what shoppers see in the tab, so the model refreshes the storefront cache then.
     */
    public function rename(BuilderDocument $document, string $title): BuilderDocument
    {
        $title = trim($title);

        return DB::transaction(function () use ($document, $title) {
            $locked = $this->lock($document);
            $before = $locked->title;
            if ($before === $title) {
                return $locked;
            }

            $locked->title = $title;
            $locked->save();
            $this->audit->record('storefront.builder_renamed', $locked, ['title' => $before], ['title' => $title]);

            return $locked;
        });
    }

    /**
     * Snapshots the draft as version max+1 and makes it the live page.
     */
    public function publish(BuilderDocument $document, ?string $note): BuilderDocument
    {
        return DB::transaction(function () use ($document, $note) {
            $locked = $this->lock($document);
            if (($locked->draft['sections'] ?? []) === []) {
                throw new BusinessRuleViolation('DOCUMENT_EMPTY', 'Add at least one section before publishing this page.');
            }

            $version = BuilderVersion::query()->create([
                'document_id' => $locked->id,
                'number' => (int) BuilderVersion::query()->where('document_id', $locked->id)->max('number') + 1,
                'schema_version' => $locked->schema_version,
                'content' => $locked->draft,
                'note' => $note === null || trim($note) === '' ? null : trim($note),
                'published_at' => CarbonImmutable::now(),
                'created_by' => StaffActor::id(),
            ]);
            $before = $locked->published_version_id;
            $locked->published_version_id = $version->id;
            $locked->save();

            $this->audit->record('storefront.builder_published', $locked, ['published_version_id' => $before], [
                'published_version_id' => $version->id,
                'number' => $version->number,
            ], ['note' => $version->note]);

            return $locked;
        });
    }

    /**
     * The draft goes back to the published content.
     */
    public function discard(BuilderDocument $document): BuilderDocument
    {
        return DB::transaction(function () use ($document) {
            $locked = $this->lock($document);
            $published = $locked->publishedVersion;
            if ($published === null) {
                throw new BusinessRuleViolation('NOTHING_PUBLISHED', 'This page has never been published, so there is nothing to go back to.', [], 409);
            }

            $locked = $this->writeDraft($locked, $published->content);
            $this->audit->record('storefront.builder_discarded', $locked, [], ['number' => $published->number]);

            return $locked;
        });
    }

    /**
     * Copies a version into the draft; it goes live only when published.
     */
    public function restore(BuilderDocument $document, BuilderVersion $version): BuilderDocument
    {
        return DB::transaction(function () use ($document, $version) {
            $locked = $this->writeDraft($this->lock($document), $version->content);
            $this->audit->record('storefront.builder_restored', $locked, [], ['version_id' => $version->id, 'number' => $version->number]);

            return $locked;
        });
    }

    /**
     * Every document but the home page (landing pages; B4: CMS page designs, header, footer and
     * zones — the store goes back to the classic rendering); the versions go with the document.
     */
    public function delete(BuilderDocument $document): void
    {
        if ($document->isHome()) {
            throw new BusinessRuleViolation('CANNOT_DELETE_HOME', 'The home page cannot be deleted. Discard its changes or publish another version instead.');
        }

        DB::transaction(function () use ($document) {
            $locked = $this->lock($document);
            $snapshot = ['key' => $locked->key, 'title' => $locked->title, 'published_version_id' => $locked->published_version_id];
            // The document points at a version and the versions at the document: unhook first.
            if ($locked->published_version_id !== null) {
                $locked->published_version_id = null;
                $locked->save();
            }
            BuilderVersion::query()->where('document_id', $locked->id)->delete();
            $locked->delete();
            $this->audit->record('storefront.builder_deleted', $locked, $snapshot);
        });
    }

    private function lock(BuilderDocument $document): BuilderDocument
    {
        return BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
    }

    /**
     * P1b: how many product zone versions (for a category or a product) the organization has.
     */
    public function targetedZoneCount(): int
    {
        return BuilderDocument::query()->where('kind', BuilderDocument::KIND_ZONE)
            ->where('key', 'like', BuilderDocument::ZONE_PREFIX.'%@%')->count();
    }

    /**
     * P1b: serializes adding zone versions in this organization until the transaction ends
     * (SQLite serializes writers anyway).
     */
    private function lockZoneVersions(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['builder-zone-versions:'.$this->tenant->requireOrganization()]);
        }
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function writeDraft(BuilderDocument $document, array $content): BuilderDocument
    {
        $document->draft = $content;
        $document->draft_revision++;
        $document->draft_updated_at = CarbonImmutable::now();
        $document->draft_updated_by = StaffActor::id();
        $document->save();

        return $document;
    }
}
