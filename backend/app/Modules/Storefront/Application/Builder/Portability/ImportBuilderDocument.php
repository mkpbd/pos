<?php

namespace App\Modules\Storefront\Application\Builder\Portability;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Application\Builder\Collaboration\BuilderEditLock;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\PrepareBuilderContent;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Experiments;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\Portable\PortableRefs;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use JsonException;
use Throwable;

/**
 * B16: a page file (ExportBuilderDocument) into this store — as a new landing page or as the
 * draft of an existing document of the same kind. Never published.
 *
 * - The file is checked first (format `pos-builder-page` version 1, ≤ 30 MB, pictures ≤ 25 MB:
 *   422 IMPORT_INVALID with `details.reason` / IMPORT_TOO_LARGE), then the target (409
 *   DOCUMENT_EXISTS, 409 DRAFT_CONFLICT, 423 DOCUMENT_LOCKED, 422 IMPORT_KIND_MISMATCH).
 * - Pictures go through the media library with the upload's checks; identical bytes already in
 *   the library are reused (sha256). A picture that fails the checks is missing.
 * - Products are matched by SKU, then web address; categories and brands by web address, then
 *   name; blog categories by web address, then name; menus by place, then name. Banners are
 *   created (or an identical one reused) with their pictures. Promotions are this store's own:
 *   always missing.
 * - What is missing leaves the page (PortableRefs: a list item, else the element), and so does
 *   anything the store cannot hold (custom HTML without storefront.custom_html, elements the
 *   checks refuse) — all counted in the report: `{mapped: {type: n}, missing: [{type, name}],
 *   dropped_elements: [{type, count}]}`.
 *
 * Audited (`storefront.builder_imported`) besides the document's own create / draft audit.
 */
class ImportBuilderDocument
{
    public const MAX_FILE_BYTES = 30 * 1024 * 1024;

    /** The importable kinds of a file → the reference list key in `references`. */
    private const LISTS = [
        'product' => 'products', 'category' => 'categories', 'brand' => 'brands', 'banner' => 'banners',
        'menu' => 'menus', 'blog_category' => 'blog_categories', 'promotion' => 'promotions',
    ];

    private const MAX_PASSES = 12;

    public function __construct(
        private readonly ManageBuilderDocuments $documents,
        private readonly PrepareBuilderContent $prepare,
        private readonly MediaLibrary $media,
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly ManageBanners $banners,
        private readonly BuilderEditLock $lock,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{target: 'new'|'replace', title?: string, key?: string, document_id?: string, revision?: int}  $target  validated
     * @return array{document: BuilderDocument, created: bool, mapped: array<string, int>, missing: list<array{type: string, name: string}>, dropped_elements: list<array{type: string, count: int}>}
     */
    public function __invoke(UploadedFile $file, array $target, bool $mayEditCustomHtml): array
    {
        $data = $this->read($file);
        $fileContext = $data['document']['context'];
        $global = $data['document']['kind'] === BuilderDocument::KIND_GLOBAL;

        $existing = null;
        if ($target['target'] === 'replace') {
            $existing = BuilderDocument::query()->builder()->findOrFail((string) $target['document_id']);
            if ($existing->isGlobal() !== $global || ! self::compatible($existing->contentContext(), $fileContext)) {
                throw new BusinessRuleViolation('IMPORT_KIND_MISMATCH', 'This file holds another kind of page. Import it into a page of the same kind, or as a new page.', [
                    'file_kind' => $data['document']['key_kind'],
                ]);
            }
            if ($existing->draft_revision !== (int) $target['revision']) {
                throw new BusinessRuleViolation('DRAFT_CONFLICT', 'This page was changed elsewhere since you opened it. Reload it to continue.', ['revision' => $existing->draft_revision], 409);
            }
            $this->lock->assertCanWrite($existing);
            $context = $existing->contentContext();
        } else {
            if ($global || ! self::compatible('page', $fileContext)) {
                throw new BusinessRuleViolation('IMPORT_KIND_MISMATCH', 'This file holds a part of the store, not a page. Import it into the same part instead.', [
                    'file_kind' => $data['document']['key_kind'],
                ]);
            }
            if (BuilderDocument::query()->where('key', $target['key'])->exists()) {
                throw new BusinessRuleViolation('DOCUMENT_EXISTS', 'Another landing page already uses this address.', ['key' => $target['key']], 409);
            }
            $context = 'page';
        }

        $missing = [];
        $mapped = array_fill_keys(['media', 'products', 'categories', 'brands', 'banners', 'menus', 'blog_categories', 'promotions'], 0);
        /** @var array<string, ?string> $ids reference => id */
        $ids = $this->importMedia($data['media'], $missing, $mapped);

        return DB::transaction(function () use ($data, $target, $existing, $context, $global, $mayEditCustomHtml, $ids, $missing, $mapped) {
            $ids += $this->mapReferences($data['references'], $ids, $missing, $mapped);
            [$content, $dropped] = PortableRefs::decode($data['document']['content'], $ids);
            // References the file uses but does not explain are missing too (already left out).
            if (! $mayEditCustomHtml) {
                $content = PortableRefs::removeElementType($content, 'custom_html', $dropped);
            }
            // A/B tests arrive as drafts (status, dates and winner are this store's server's).
            foreach (is_array($content['experiments'] ?? null) ? array_keys($content['experiments']) : [] as $i) {
                if (is_array($content['experiments'][$i])) {
                    foreach (Experiments::MANAGED as $field) {
                        $content['experiments'][$i][$field] = $field === 'status' ? 'draft' : null;
                    }
                }
            }
            $content = $this->fit($content, $context, $global, $dropped);

            if ($existing !== null) {
                $document = $this->documents->saveDraft($existing, (int) $target['revision'], $content, $mayEditCustomHtml);
                $created = false;
            } else {
                $document = $this->documents->create([
                    'kind' => BuilderDocument::KIND_PAGE,
                    'key' => (string) $target['key'],
                    'title' => trim((string) $target['title']),
                    'from' => 'import',
                ], $content);
                $created = true;
            }

            $droppedList = [];
            foreach ($dropped as $type => $count) {
                $droppedList[] = ['type' => (string) $type, 'count' => $count];
            }
            $this->audit->record('storefront.builder_imported', $document, [], [], [
                'target' => $created ? 'new' : 'replace',
                'source_store' => $data['source']['store'] ?? null,
                'file_kind' => $data['document']['key_kind'],
                'mapped' => $mapped,
                'missing' => count($missing),
                'dropped_elements' => array_sum($dropped),
            ]);

            return ['document' => $document, 'created' => $created, 'mapped' => $mapped, 'missing' => $missing, 'dropped_elements' => $droppedList];
        });
    }

    /**
     * The file, checked: 422 IMPORT_TOO_LARGE / IMPORT_INVALID (`details.reason`).
     *
     * @return array{document: array{kind: string, key_kind: string, title: string, context: string, content: array<string, mixed>}, media: list<array<string, mixed>>, references: array<string, mixed>, source: array<string, mixed>}
     */
    private function read(UploadedFile $file): array
    {
        if ((int) $file->getSize() > self::MAX_FILE_BYTES) {
            throw self::tooLarge();
        }
        $invalid = fn (string $reason, string $message = 'This file is not a page downloaded from a store builder.') => new BusinessRuleViolation('IMPORT_INVALID', $message, ['reason' => $reason]);
        try {
            $data = json_decode((string) file_get_contents((string) $file->getRealPath()), true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw $invalid('not_json');
        }
        if (! is_array($data) || ($data['format'] ?? null) !== ExportBuilderDocument::FORMAT) {
            throw $invalid('format');
        }
        if (($data['version'] ?? null) !== ExportBuilderDocument::VERSION) {
            throw $invalid('version', 'This page file was made by a newer version of the store builder. Update and try again.');
        }
        $validator = Validator::make($data, [
            'document' => ['required', 'array'],
            'document.kind' => ['required', 'string', 'in:'.implode(',', BuilderDocument::BUILDER_KINDS)],
            'document.key_kind' => ['required', 'string', 'max:20'],
            'document.title' => ['required', 'string', 'max:160'],
            'document.context' => ['required', 'string', 'max:40'],
            'document.content' => ['required', 'array'],
            'document.content.sections' => ['present', 'array', 'list'],
            'media' => ['present', 'array', 'list'],
            'media.*' => ['array'],
            'media.*.ref' => ['required', 'string', 'regex:/^@ref:media:[1-9][0-9]{0,5}$/'],
            'media.*.data' => ['required', 'string'],
            'references' => ['present', 'array'],
            'source' => ['sometimes', 'array'],
        ]);
        if ($validator->fails()) {
            throw new BusinessRuleViolation('IMPORT_INVALID', 'This page file is damaged or incomplete.', ['reason' => 'structure', 'errors' => $validator->errors()->toArray()]);
        }
        $context = $data['document']['context'];
        if (! in_array(BuilderDocumentSchema::baseContext($context), ['page', 'cms', 'zone', 'header', 'footer', 'popup', 'template'], true)) {
            throw $invalid('context');
        }
        $bytes = 0;
        foreach ($data['media'] as $media) {
            $bytes += (int) (strlen($media['data']) * 3 / 4);
        }
        if ($bytes > ExportBuilderDocument::MAX_MEDIA_BYTES + 1024) {
            throw self::tooLarge();
        }
        $data['source'] = is_array($data['source'] ?? null) ? $data['source'] : [];

        return $data;
    }

    private static function tooLarge(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('IMPORT_TOO_LARGE', 'This file is too large. A page file can be up to 30 MB with up to 25 MB of pictures.', [
            'limit_bytes' => self::MAX_FILE_BYTES,
            'media_limit_bytes' => ExportBuilderDocument::MAX_MEDIA_BYTES,
        ]);
    }

    /**
     * Whether a file made in `$fileContext` fits a document in `$context` (pages and content
     * pages take each other; everything else only its own kind).
     */
    private static function compatible(string $context, string $fileContext): bool
    {
        $pages = ['page', 'cms'];

        return $context === $fileContext || (in_array($context, $pages, true) && in_array($fileContext, $pages, true));
    }

    /**
     * @param  list<array<string, mixed>>  $files
     * @param  list<array{type: string, name: string}>  $missing
     * @param  array<string, int>  $mapped
     * @return array<string, ?string> media reference => id
     */
    private function importMedia(array $files, array &$missing, array &$mapped): array
    {
        $ids = [];
        foreach ($files as $file) {
            $ref = (string) $file['ref'];
            $name = self::fileName($file['name'] ?? null);
            $bytes = base64_decode((string) $file['data'], true);
            $sha = $file['sha256'] ?? null;
            if ($bytes === false || $bytes === '' || (is_string($sha) && ! hash_equals(strtolower($sha), hash('sha256', $bytes)))) {
                $ids[$ref] = null;
                $missing[] = ['type' => 'media', 'name' => $name];

                continue;
            }
            $path = tempnam(sys_get_temp_dir(), 'pos-import-');
            try {
                file_put_contents($path, $bytes);
                $alt = is_string($file['alt'] ?? null) ? $file['alt'] : null;
                $ids[$ref] = $this->media->import($path, $name, $alt)['id'];
                $mapped['media']++;
            } catch (BusinessRuleViolation) {
                $ids[$ref] = null;
                $missing[] = ['type' => 'media', 'name' => $name];
            } finally {
                @unlink($path);
            }
        }

        return $ids;
    }

    private static function fileName(mixed $name): string
    {
        $name = is_string($name) ? basename(str_replace('\\', '/', $name)) : '';
        $name = preg_replace('/[^\w.\- ]+/u', '', $name) ?? '';

        return $name === '' ? 'picture' : mb_substr($name, 0, 120);
    }

    /**
     * @param  array<string, mixed>  $references
     * @param  array<string, ?string>  $media  media reference => id
     * @param  list<array{type: string, name: string}>  $missing
     * @param  array<string, int>  $mapped
     * @return array<string, ?string> reference => id
     */
    private function mapReferences(array $references, array $media, array &$missing, array &$mapped): array
    {
        $ids = [];
        $blogCategories = null;
        foreach (self::LISTS as $type => $key) {
            $entries = is_array($references[$key] ?? null) && array_is_list($references[$key]) ? $references[$key] : [];
            foreach ($entries as $entry) {
                if (! is_array($entry) || ! is_string($entry['ref'] ?? null) || preg_match(PortableRefs::PATTERN, $entry['ref'], $m) !== 1 || $m[1] !== $type) {
                    continue;
                }
                $name = self::text($entry['name'] ?? null) ?? self::text($entry['slug'] ?? null) ?? self::text($entry['sku'] ?? null) ?? 'unnamed';
                $id = match ($type) {
                    'product' => $this->catalog->findPortable('product', self::text($entry['sku'] ?? null), self::text($entry['slug'] ?? null), null),
                    'category', 'brand' => $this->catalog->findPortable($type, null, self::text($entry['slug'] ?? null), self::text($entry['name'] ?? null)),
                    'blog_category' => $this->blogCategory($entry, $blogCategories),
                    'menu' => $this->menu($entry),
                    'banner' => $this->banner($entry, $media),
                    'promotion' => null,
                };
                $ids[$entry['ref']] = $id;
                if ($id === null) {
                    $missing[] = ['type' => $type, 'name' => $name];
                } else {
                    $mapped[$key]++;
                }
            }
        }

        return $ids;
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? mb_substr(trim($value), 0, 200) : null;
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  list<array{id: string, name: string, slug: string}>|null  $categories
     */
    private function blogCategory(array $entry, ?array &$categories): ?string
    {
        $categories ??= $this->blog->linkTargets()['blog_categories'];
        $slug = self::text($entry['slug'] ?? null);
        $name = self::text($entry['name'] ?? null);
        foreach ($categories as $category) {
            if ($slug !== null && $category['slug'] === mb_strtolower($slug)) {
                return $category['id'];
            }
        }
        foreach ($categories as $category) {
            if ($name !== null && mb_strtolower($category['name']) === mb_strtolower($name)) {
                return $category['id'];
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $entry
     */
    private function menu(array $entry): ?string
    {
        $location = self::text($entry['location'] ?? null);
        if ($location !== null) {
            $id = Menu::query()->where('location', $location)->orderByDesc('is_active')->orderBy('created_at')->value('id');
            if (is_string($id)) {
                return $id;
            }
        }
        $name = self::text($entry['name'] ?? null);
        $id = $name === null ? null : Menu::query()->whereRaw('lower(name) = ?', [mb_strtolower($name)])->orderBy('created_at')->value('id');

        return is_string($id) ? $id : null;
    }

    /**
     * A banner with the file's texts and pictures: an identical one of this store is reused,
     * else it is created (active, unscheduled). Null when its picture is missing or it is invalid.
     *
     * @param  array<string, mixed>  $entry
     * @param  array<string, ?string>  $media
     */
    private function banner(array $entry, array $media): ?string
    {
        $desktop = is_string($entry['image'] ?? null) ? ($media[$entry['image']] ?? null) : null;
        if ($desktop === null) {
            return null;
        }
        $attributes = array_intersect_key($entry, array_flip(PortableTemplate::BANNER_FIELDS));
        $attributes = array_filter($attributes, fn ($v) => $v !== null);
        $validator = Validator::make($attributes, array_diff_key(PortableTemplate::bannerRules(), array_flip(['image', 'image.asset', 'mobile_image', 'mobile_image.asset'])));
        if ($validator->fails()) {
            return null;
        }
        $attributes['desktop_media_id'] = $desktop;
        $mobile = is_string($entry['mobile_image'] ?? null) ? ($media[$entry['mobile_image']] ?? null) : null;
        if ($mobile !== null) {
            $attributes['mobile_media_id'] = $mobile;
        }

        $existing = Banner::query()
            ->where('placement', $attributes['placement'])
            ->where('name', $attributes['name'])
            ->where('title', $attributes['title'] ?? null)
            ->where('link_url', $attributes['link_url'] ?? null)
            ->where('desktop_media_id', $desktop)
            ->value('id');
        if (is_string($existing)) {
            return $existing;
        }
        try {
            return $this->banners->save(new Banner, $attributes + ['is_active' => true, 'starts_at' => null, 'ends_at' => null])->id;
        } catch (BusinessRuleViolation) {
            return null;
        }
    }

    /**
     * The content made to pass this store's checks: nodes the checks refuse are dropped (and
     * counted) until it passes; A/B tests and page SEO go when the problem is theirs. 422
     * IMPORT_INVALID when it still cannot be saved.
     *
     * @param  array<string, mixed>  $content
     * @param  array<string, int>  $dropped
     * @return array<string, mixed>
     */
    private function fit(array $content, string $context, bool $global, array &$dropped): array
    {
        $errors = [];
        for ($pass = 0; $pass < self::MAX_PASSES; $pass++) {
            try {
                ($this->prepare)($content, $context, $global);

                return $content;
            } catch (InvalidBuilderDocument $e) {
                $errors = $e->errors;
            } catch (Throwable $e) {
                if ($e instanceof BusinessRuleViolation) {
                    throw new BusinessRuleViolation('IMPORT_INVALID', 'This page could not be imported: '.$e->getMessage(), ['reason' => 'content']);
                }
                throw $e;
            }
            $nodeIds = array_values(array_unique(array_filter(array_column($errors, 'node_id'), 'is_string')));
            if ($nodeIds !== []) {
                $content = PortableRefs::removeNodes($content, $nodeIds, $dropped);

                continue;
            }
            if (isset($content['experiments'])) {
                unset($content['experiments']);
                $content = self::withoutArms($content);

                continue;
            }
            if (isset($content['seo'])) {
                unset($content['seo']);

                continue;
            }
            break;
        }

        throw new BusinessRuleViolation('IMPORT_INVALID', 'This page could not be imported: some of its content does not fit this store.', ['reason' => 'content', 'errors' => $errors]);
    }

    /**
     * Sections without their A/B test markers (version B sections go).
     *
     * @param  array<string, mixed>  $content
     * @return array<string, mixed>
     */
    private static function withoutArms(array $content): array
    {
        $sections = [];
        foreach ($content['sections'] ?? [] as $section) {
            if (is_array($section) && is_array($section['experiment'] ?? null)) {
                if (($section['experiment']['arm'] ?? 'A') !== 'A') {
                    continue;
                }
                unset($section['experiment']);
            }
            $sections[] = $section;
        }
        $content['sections'] = $sections;

        return $content;
    }
}
