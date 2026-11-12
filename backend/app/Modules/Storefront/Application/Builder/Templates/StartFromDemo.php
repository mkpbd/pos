<?php

namespace App\Modules\Storefront\Application\Builder\Templates;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\ManageThemeDraft;
use App\Modules\Storefront\Application\Builder\PrepareBuilderContent;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderTemplate;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * B5: "start from a demo look" — applies a site template (Vegan, Handmade, Classic, Kids; derived from
 * the T2 demo stores; B7: and the store's original look, preset `default`) to **drafts only**, in
 * one transaction:
 *
 * - theme: the preset over the theme draft (the theme draft flow: logo, palette, announcement and
 *   footer content are kept);
 * - home, header, footer and the shop's listing-top zone: the document's draft is replaced — or
 *   the document is created — with the template's part, its photos imported into the media
 *   library, its banners created and its menus resolved (TemplateReferences). Published versions
 *   are untouched; replacing a draft bumps its revision, so an editor still open on it gets 409
 *   DRAFT_CONFLICT on its next save instead of silently overwriting.
 *
 * Nothing changes on the live store until the drafts are published (PublishBuilderDrafts).
 * Audited (`storefront.builder_started_from_demo`); the theme preset and each new document are
 * audited by their own actions too.
 */
class StartFromDemo
{
    /** Site template part => [document kind, key, title]. */
    public const PARTS = [
        'home' => [BuilderDocument::KIND_PAGE, BuilderDocument::HOME, 'Home'],
        'header' => [BuilderDocument::KIND_HEADER, BuilderDocument::HEADER, 'Header'],
        'footer' => [BuilderDocument::KIND_FOOTER, BuilderDocument::FOOTER, 'Footer'],
        'listing_top' => [BuilderDocument::KIND_ZONE, BuilderDocument::ZONE_PREFIX.'listing.top', 'Listing top'],
    ];

    public function __construct(
        private readonly BuilderTemplateLibrary $library,
        private readonly ManageBuilderDocuments $documents,
        private readonly ManageThemeDraft $theme,
        private readonly PrepareBuilderContent $prepare,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{theme?: bool, home?: bool, header?: bool, footer?: bool, listing_top?: bool}  $include  missing = true
     * @return array{documents: list<BuilderDocument>, theme: bool, imported: array{media: int, banners: int, banners_reused: int}}
     */
    public function __invoke(string $preset, array $include = []): array
    {
        $template = $this->library->site($preset);
        if ($template === null) {
            throw (new ModelNotFoundException)->setModel(BuilderTemplate::class, [$preset]);
        }
        $wanted = fn (string $part) => (bool) ($include[$part] ?? true);

        return DB::transaction(function () use ($template, $preset, $wanted) {
            /** @var TemplateReferences $references */
            $references = app(TemplateReferences::class);
            $used = [];
            $newId = function (string $prefix) use (&$used): string {
                do {
                    $id = $prefix.'_'.Str::lower(Str::random(10));
                } while (isset($used[$id]));
                $used[$id] = true;

                return $id;
            };

            // Resolve and validate every part first: a problem leaves every draft as it was.
            $contents = [];
            foreach (self::PARTS as $part => [, $key]) {
                if (! $wanted($part)) {
                    continue;
                }
                $context = BuilderDocumentSchema::contextOf($key);
                $sections = PortableTemplate::concrete($this->library->sections($template['id'], $context), $references, $newId);
                $contents[$part] = ($this->prepare)(['schema_version' => BuilderDocumentSchema::SCHEMA_VERSION, 'sections' => $sections], $context);
            }

            if ($wanted('theme')) {
                $this->theme->applyPreset($preset);
            }

            $documents = [];
            $replaced = [];
            foreach ($contents as $part => $content) {
                [$kind, $key, $title] = self::PARTS[$part];
                $existing = BuilderDocument::query()->builder()->where('key', $key)->first();
                if ($existing === null) {
                    $documents[] = $this->documents->create(['kind' => $kind, 'key' => $key, 'title' => $title, 'from' => 'demo:'.$preset], $content);
                } else {
                    $documents[] = $this->documents->saveDraft($existing, $existing->draft_revision, $content);
                    $replaced[] = $key;
                }
            }

            $imported = $references->summary();
            $this->audit->record('storefront.builder_started_from_demo', null, [], [
                'preset' => $preset,
                'template_id' => $template['id'],
                'theme' => $wanted('theme'),
                'documents' => array_map(fn (BuilderDocument $d) => $d->key, $documents),
                'replaced' => $replaced,
            ] + $imported);

            return ['documents' => $documents, 'theme' => $wanted('theme'), 'imported' => $imported];
        });
    }
}
