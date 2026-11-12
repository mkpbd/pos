<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Illuminate\Support\Facades\DB;

/**
 * B5: "publish all" — publishes several builder drafts (pages, header, footer, zones) and
 * optionally the theme draft in one transaction: each becomes a new version exactly as with its
 * own publish (audited each), and either all go live or none (an empty page, `DOCUMENT_EMPTY`,
 * rolls everything back). Documents must be the organization's own builder documents (another
 * organization's or an unknown id: 422 DOCUMENTS_NOT_FOUND, nothing published). Audited
 * (`storefront.builder_published_all`).
 */
class PublishBuilderDrafts
{
    public const MAX_DOCUMENTS = 50;

    public function __construct(
        private readonly ManageBuilderDocuments $documents,
        private readonly ManageThemeDraft $theme,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  list<string>  $documentIds
     * @return array{documents: list<BuilderDocument>, theme: ?BuilderDocument}
     */
    public function __invoke(array $documentIds, bool $theme, ?string $note): array
    {
        $ids = array_values(array_unique(array_map('strtolower', $documentIds)));
        if ($ids === [] && ! $theme) {
            throw new BusinessRuleViolation('NOTHING_TO_PUBLISH', 'Choose at least one page or the theme to publish.');
        }

        return DB::transaction(function () use ($ids, $theme, $note) {
            $found = BuilderDocument::query()->builder()->whereIn('id', $ids)->get()->keyBy('id');
            $missing = array_values(array_diff($ids, $found->keys()->all()));
            if ($missing !== []) {
                throw new BusinessRuleViolation('DOCUMENTS_NOT_FOUND', 'Some of these pages no longer exist. Reload and try again.', ['ids' => $missing]);
            }

            $published = [];
            foreach ($ids as $id) {
                $published[] = $this->documents->publish($found[$id], $note);
            }
            $themeDocument = $theme ? $this->theme->publish($note) : null;

            $this->audit->record('storefront.builder_published_all', null, [], [
                'documents' => array_map(fn (BuilderDocument $d) => ['id' => $d->id, 'key' => $d->key], $published),
                'theme' => $theme,
            ], ['note' => $note]);

            return ['documents' => $published, 'theme' => $themeDocument];
        });
    }
}
