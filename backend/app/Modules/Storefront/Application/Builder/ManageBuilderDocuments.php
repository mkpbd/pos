<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Store builder documents (B1): create (blank or from the current homepage), save the draft
 * with optimistic concurrency, publish (a new immutable version), discard the draft, restore
 * a version into the draft, delete a landing page. Publishing, discarding, restoring and
 * deleting are audited; what shoppers see changes only on publish (and deleting a published
 * landing page), which bumps the storefront content version through the model.
 */
class ManageBuilderDocuments
{
    public function __construct(
        private readonly PrepareBuilderContent $prepare,
        private readonly HomepageImporter $importer,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{kind: string, key: string, title: string, from?: ?string}  $attributes  validated
     */
    public function create(array $attributes): BuilderDocument
    {
        $content = ($attributes['from'] ?? 'blank') === 'homepage'
            ? ($this->prepare)($this->importer->document())
            : BuilderDocumentSchema::blank();

        return DB::transaction(function () use ($attributes, $content) {
            if (BuilderDocument::query()->where('key', $attributes['key'])->lockForUpdate()->exists()) {
                throw new BusinessRuleViolation('DOCUMENT_EXISTS', $attributes['key'] === BuilderDocument::HOME
                    ? 'The store already has a builder home page.'
                    : 'Another landing page already uses this address.', ['key' => $attributes['key']], 409);
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
                'from' => $attributes['from'] ?? 'blank',
            ]);

            return $document;
        });
    }

    /**
     * Replaces the draft. `$revision` is the revision the editor started from; a newer one
     * (another tab or person saved meanwhile) is 409 DRAFT_CONFLICT with the current revision.
     *
     * @param  array<string, mixed>  $content
     */
    public function saveDraft(BuilderDocument $document, int $revision, array $content): BuilderDocument
    {
        $content = ($this->prepare)($content);

        return DB::transaction(function () use ($document, $revision, $content) {
            $locked = $this->lock($document);
            if ($locked->draft_revision !== $revision) {
                throw new BusinessRuleViolation('DRAFT_CONFLICT', 'This page was changed elsewhere since you opened it. Reload it to continue.', ['revision' => $locked->draft_revision], 409);
            }

            return $this->writeDraft($locked, $content);
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
     * Landing pages only; the versions go with the document.
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
