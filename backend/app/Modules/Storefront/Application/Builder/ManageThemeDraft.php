<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Actions\SaveTheme;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * B3: the theme under the same draft → publish flow as builder pages (plan §10 decision 4).
 *
 * The draft is a builder document (`kind` and `key` `theme`, one per organization) holding a
 * normalized theme document (ThemeSchema); published versions are builder versions. The row is
 * created on the first write (draft save, preset, publish, discard, restore) from the live
 * theme — until then the draft *is* the live theme at revision 0, so reading never writes.
 *
 * The live theme (`theme_settings`, what shoppers see) changes only on publish, through
 * SaveTheme (media check, audit, storefront cache bust). The first publish first records
 * what was live before as version 1, so the history starts there. Custom CSS is not part of
 * the draft (it stays immediate). Draft saves are not audited; presets, publish, discard and
 * restore are.
 */
class ManageThemeDraft
{
    public const FIRST_VERSION_NOTE = 'Live theme before the first publish';

    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly SaveTheme $save,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * The theme document, or null while nothing has been drafted yet.
     */
    public function find(): ?BuilderDocument
    {
        return BuilderDocument::query()->with('publishedVersion')
            ->where('kind', BuilderDocument::KIND_THEME)->where('key', BuilderDocument::THEME)->first();
    }

    /**
     * The draft theme (normalized): the document's draft, or the live theme before the first draft.
     *
     * @return array<string, mixed>
     */
    public function settings(?BuilderDocument $document = null): array
    {
        $document ??= $this->find();

        return $document === null ? $this->config->theme()->settings : ThemeSchema::normalize($document->draft);
    }

    /**
     * @return array{document: ?BuilderDocument, settings: array<string, mixed>, has_unpublished_changes: bool}
     */
    public function state(): array
    {
        $document = $this->find();
        $settings = $this->settings($document);

        return [
            'document' => $document,
            'settings' => $settings,
            'has_unpublished_changes' => $document !== null && ! ThemeSchema::same($settings, $this->config->theme()->settings),
        ];
    }

    /**
     * Replaces the draft. `$revision` is the revision the editor started from (0 before the first
     * draft); a newer one is 409 DRAFT_CONFLICT with the current revision.
     *
     * @param  array<string, mixed>  $settings  validated
     */
    public function saveDraft(int $revision, array $settings): BuilderDocument
    {
        $settings = $this->save->prepare($settings);

        return DB::transaction(function () use ($revision, $settings) {
            $document = $this->document();
            if ($document->draft_revision !== $revision) {
                throw new BusinessRuleViolation('DRAFT_CONFLICT', 'The theme was changed elsewhere since you opened it. Reload it to continue.', ['revision' => $document->draft_revision], 409);
            }

            return $this->writeDraft($document, $settings);
        });
    }

    /**
     * Puts a preset's colours, fonts, shape and layout over the draft (content and palette are
     * kept). Live only once published.
     */
    public function applyPreset(string $preset): BuilderDocument
    {
        return DB::transaction(function () use ($preset) {
            $document = $this->document();
            $document = $this->writeDraft($document, $this->save->prepare(ThemePresets::apply($preset, $this->settings($document))));
            $this->audit->record('storefront.theme_preset_applied', $document, [], ['preset' => $preset]);

            return $document;
        });
    }

    /**
     * Makes the draft the live theme and records it as version max+1.
     */
    public function publish(?string $note): BuilderDocument
    {
        return DB::transaction(function () use ($note) {
            $document = $this->document();
            $draft = $this->settings($document);

            if (! BuilderVersion::query()->where('document_id', $document->id)->exists()) {
                $live = $this->config->theme();
                $this->version($document, $live->settings, self::FIRST_VERSION_NOTE, $live->updated_at ?? CarbonImmutable::now(), null);
            }

            $theme = $this->save->settings($draft);
            $version = $this->version($document, $theme->settings, $note, CarbonImmutable::now(), StaffActor::id());

            $before = $document->published_version_id;
            $document->published_version_id = $version->id;
            $document->draft = $theme->settings;
            $document->save();

            $this->audit->record('storefront.theme_published', $document, ['published_version_id' => $before], [
                'published_version_id' => $version->id,
                'number' => $version->number,
            ], ['note' => $version->note]);

            return $document->load('publishedVersion');
        });
    }

    /**
     * Legacy `PUT /storefront/theme`: saves the draft and publishes it in one step (no revision check).
     *
     * @param  array<string, mixed>  $settings  validated
     */
    public function saveAndPublish(array $settings): BuilderDocument
    {
        $settings = $this->save->prepare($settings);

        return DB::transaction(function () use ($settings) {
            $this->writeDraft($this->document(), $settings);

            return $this->publish(null);
        });
    }

    /**
     * The draft goes back to the live theme.
     */
    public function discard(): BuilderDocument
    {
        return DB::transaction(function () {
            $document = $this->writeDraft($this->document(), $this->config->theme()->settings);
            $this->audit->record('storefront.theme_draft_discarded', $document);

            return $document;
        });
    }

    /**
     * Copies a version of the theme into the draft (normalized: older versions get the newer
     * keys' defaults); it goes live when published. Another document's version: 404.
     */
    public function restore(string $versionId): BuilderDocument
    {
        return DB::transaction(function () use ($versionId) {
            $document = $this->document();
            $version = BuilderVersion::query()->where('document_id', $document->id)->whereKey($versionId)->firstOrFail();
            $document = $this->writeDraft($document, $this->save->prepare($version->content));
            $this->audit->record('storefront.theme_restored', $document, [], ['version_id' => $version->id, 'number' => $version->number]);

            return $document;
        });
    }

    /**
     * Newest first; empty before the first publish.
     *
     * @return Collection<int, BuilderVersion>
     */
    public function versions(): Collection
    {
        $document = $this->find();

        return $document === null ? collect() : $document->versions()->orderByDesc('number')->get();
    }

    /**
     * The theme document, created from the live theme when missing, locked for the transaction.
     */
    private function document(): BuilderDocument
    {
        $locked = fn (string $id) => BuilderDocument::query()->with('publishedVersion')->whereKey($id)->lockForUpdate()->firstOrFail();
        $id = BuilderDocument::query()->where('kind', BuilderDocument::KIND_THEME)->where('key', BuilderDocument::THEME)->value('id');
        if (is_string($id)) {
            return $locked($id);
        }

        // Two first writes at once: one creates the row, the other finds it (unique organization + key).
        $document = BuilderDocument::query()->createOrFirst(
            ['kind' => BuilderDocument::KIND_THEME, 'key' => BuilderDocument::THEME],
            [
                'title' => 'Theme',
                'schema_version' => 1,
                'draft' => $this->config->theme()->settings,
                'draft_revision' => 0,
                'draft_updated_at' => CarbonImmutable::now(),
                'draft_updated_by' => StaffActor::id(),
            ],
        );

        return $locked($document->id);
    }

    /**
     * @param  array<string, mixed>  $settings  prepared
     */
    private function writeDraft(BuilderDocument $document, array $settings): BuilderDocument
    {
        $document->draft = $settings;
        $document->draft_revision++;
        $document->draft_updated_at = CarbonImmutable::now();
        $document->draft_updated_by = StaffActor::id();
        $document->save();

        return $document;
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function version(BuilderDocument $document, array $settings, ?string $note, DateTimeInterface $publishedAt, ?string $createdBy): BuilderVersion
    {
        return BuilderVersion::query()->create([
            'document_id' => $document->id,
            'number' => (int) BuilderVersion::query()->where('document_id', $document->id)->max('number') + 1,
            'schema_version' => 1,
            'content' => $settings,
            'note' => $note === null || trim($note) === '' ? null : trim($note),
            'published_at' => $publishedAt,
            'created_by' => $createdBy,
        ]);
    }
}
