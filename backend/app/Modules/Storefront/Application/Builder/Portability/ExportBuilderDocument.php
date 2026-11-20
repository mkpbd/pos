<?php

namespace App\Modules\Storefront\Application\Builder\Portability;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\BuilderGlobals;
use App\Modules\Storefront\Application\Builder\BuilderReferences;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Domain\Builder\Experiments;
use App\Modules\Storefront\Domain\Builder\Portable\PortableRefs;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\StorefrontSettings;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * B16: a builder document's draft as a portable file (`pos-builder-page`, version 1) another
 * store can import:
 *
 * - global sections are inlined as plain sections (the draft of each global; a global shown
 *   twice gets fresh node ids the second time; a missing one is left out);
 * - audience rules keep districts (shared reference data) but lose campaign rules (campaigns are
 *   this store's), and A/B tests go back to drafts (no status, dates or winner);
 * - every record id becomes a reference (PortableRefs) explained in `media` (the original files,
 *   base64, with sha256 — at most 25 MB together, else 422 EXPORT_TOO_LARGE) and `references`
 *   (products by SKU and web address, categories / brands / blog categories by web address and
 *   name, banners with their texts and pictures, menus by place and name, promotions by name).
 *
 * Nothing personal travels (no customers, orders or staff). Audited (`storefront.builder_exported`).
 */
class ExportBuilderDocument
{
    public const FORMAT = 'pos-builder-page';

    public const VERSION = 1;

    public const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

    /** Reference check codes (BuilderReferences::collect) → reference types; others stay as they are. */
    private const TYPES = [
        'MEDIA_NOT_FOUND' => 'media',
        'BANNER_NOT_FOUND' => 'banner',
        'PRODUCT_NOT_FOUND' => 'product',
        'CATEGORY_NOT_FOUND' => 'category',
        'BRAND_NOT_FOUND' => 'brand',
        'PROMOTION_NOT_FOUND' => 'promotion',
        'DISCOUNT_NOT_FOUND' => 'promotion',
        'BLOG_CATEGORY_NOT_FOUND' => 'blog_category',
        'MENU_NOT_FOUND' => 'menu',
    ];

    public function __construct(
        private readonly BuilderGlobals $globals,
        private readonly BuilderReferences $references,
        private readonly MediaLibrary $media,
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly PromotionShowcase $promotions,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @return array{filename: string, body: array<string, mixed>}
     */
    public function __invoke(BuilderDocument $document): array
    {
        if (! in_array($document->kind, BuilderDocument::BUILDER_KINDS, true)) {
            throw new BusinessRuleViolation('EXPORT_NOT_SUPPORTED', 'Only store builder pages, parts and sections can be downloaded as a file.');
        }
        $context = $document->contentContext();
        $content = $this->portableContent($document, $context);

        /** @var array<string, array<string, true>> $ids type => ids in order of use */
        $ids = [];
        foreach ($this->references->collect($content)['uses'] as $code => $uses) {
            $type = self::TYPES[explode(':', $code)[0]] ?? null;
            if ($type === null) {
                continue;
            }
            foreach ($uses as $use) {
                foreach ($use['ids'] as $id) {
                    $ids[$type][$id] = true;
                }
            }
        }
        $banners = Banner::query()->whereIn('id', array_keys($ids['banner'] ?? []))->get()->keyBy('id');
        foreach ($banners as $banner) {
            foreach ([$banner->desktop_media_id, $banner->mobile_media_id] as $mediaId) {
                if (is_string($mediaId)) {
                    $ids['media'][$mediaId] = true;
                }
            }
        }

        /** @var array<string, string> $refs id => reference */
        $refs = [];
        foreach (PortableRefs::TYPES as $type) {
            $n = 0;
            foreach (array_keys($ids[$type] ?? []) as $id) {
                $refs[$id] = PortableRefs::make($type, ++$n);
            }
        }

        $media = $this->mediaFiles(array_keys($ids['media'] ?? []), $refs);
        $body = [
            'format' => self::FORMAT,
            'version' => self::VERSION,
            'exported_at' => CarbonImmutable::now()->toIso8601String(),
            'source' => ['store' => (string) (StorefrontSettings::query()->value('site_name') ?? '')],
            'document' => [
                'kind' => $document->kind,
                'key_kind' => self::keyKind($document),
                'key' => $document->key,
                'title' => $document->title,
                'context' => $context,
                'schema_version' => (int) $document->schema_version,
                'content' => BuilderJson::present(PortableRefs::encode($content, $refs)),
            ],
            'media' => $media['files'],
            'references' => $this->references($ids, $refs, $banners->all()),
        ];

        $this->audit->record('storefront.builder_exported', $document, [], [], [
            'media' => count($media['files']),
            'media_bytes' => $media['bytes'],
        ]);

        $slug = $document->landingSlug() ?? Str::slug($document->title);

        return ['filename' => ($slug === '' ? 'page' : Str::limit($slug, 80, '')).'.json', 'body' => $body];
    }

    /**
     * The draft with globals inlined, campaign rules dropped and A/B tests as drafts.
     *
     * @return array<string, mixed>
     */
    private function portableContent(BuilderDocument $document, string $context): array
    {
        $content = $document->draft;
        if (! $document->isGlobal()) {
            $sections = [];
            foreach ($this->globals->expand($content, 'draft', $context)['sections'] ?? [] as $section) {
                if (($section['type'] ?? null) === BuilderDocumentSchema::GLOBAL_SECTION) {
                    // A global that is gone (or made for another part of the store) stays behind.
                    continue;
                }
                if (isset($section['global'])) {
                    $ref = is_array($section['global_ref'] ?? null) ? $section['global_ref'] : [];
                    unset($section['global'], $section['global_ref']);
                    if (($ref['hidden'] ?? false) === true) {
                        $section['hidden'] = true;
                    }
                    if (is_array($ref['schedule'] ?? null)) {
                        $section['schedule'] = $ref['schedule'];
                    }
                }
                $sections[] = $section;
            }
            $content['sections'] = $sections;
            $content = PortableRefs::uniqueIds($content);
        }
        if (is_array($content['experiments'] ?? null)) {
            foreach (array_keys($content['experiments']) as $i) {
                foreach (Experiments::MANAGED as $field) {
                    $content['experiments'][$i][$field] = $field === 'status' ? 'draft' : null;
                }
            }
        }

        return self::withoutCampaigns($content);
    }

    /**
     * Campaign audience rules removed everywhere (an audience left without rules is everyone).
     */
    private static function withoutCampaigns(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (is_array($value['audience']['rules'] ?? null)) {
            $rules = array_values(array_filter($value['audience']['rules'], fn ($rule) => ! is_array($rule) || ($rule['kind'] ?? null) !== 'campaign'));
            $value['audience'] = $rules === [] ? null : ['rules' => $rules] + $value['audience'];
        }
        foreach ($value as $key => $child) {
            if ($key !== 'audience' && is_array($child)) {
                $value[$key] = self::withoutCampaigns($child);
            }
        }

        return $value;
    }

    /**
     * @param  list<string>  $mediaIds
     * @param  array<string, string>  $refs
     * @return array{files: list<array<string, mixed>>, bytes: int}
     */
    private function mediaFiles(array $mediaIds, array $refs): array
    {
        $files = [];
        $bytes = 0;
        foreach ($mediaIds as $id) {
            $file = $this->media->originalFile($id);
            if ($file === null) {
                continue;
            }
            $bytes += $file['size'];
            if ($bytes > self::MAX_MEDIA_BYTES) {
                throw new BusinessRuleViolation('EXPORT_TOO_LARGE', 'The pictures on this page add up to more than 25 MB, which is too much for one file. Use fewer or smaller pictures and try again.', [
                    'limit_bytes' => self::MAX_MEDIA_BYTES,
                ]);
            }
            $files[] = [
                'ref' => $refs[$id],
                'name' => $file['name'],
                'alt' => $file['alt'],
                'mime' => $file['mime_type'],
                'width' => $file['width'],
                'height' => $file['height'],
                'sha256' => $file['sha256'],
                'data' => base64_encode($file['contents']),
            ];
        }

        return ['files' => $files, 'bytes' => $bytes];
    }

    /**
     * @param  array<string, array<string, true>>  $ids
     * @param  array<string, string>  $refs
     * @param  array<string, Banner>  $banners
     * @return array<string, list<array<string, mixed>>>
     */
    private function references(array $ids, array $refs, array $banners): array
    {
        $list = fn (string $type) => array_keys($ids[$type] ?? []);
        $result = ['products' => [], 'categories' => [], 'brands' => [], 'banners' => [], 'menus' => [], 'blog_categories' => [], 'promotions' => []];

        // In reference order (the records' own order may differ).
        $products = $this->catalog->portableReferences('product', $list('product'));
        foreach ($list('product') as $id) {
            if (isset($products[$id])) {
                $result['products'][] = ['ref' => $refs[$id], 'sku' => $products[$id]['sku'], 'slug' => $products[$id]['slug'], 'name' => $products[$id]['name']];
            }
        }
        foreach (['category' => 'categories', 'brand' => 'brands'] as $type => $key) {
            $records = $this->catalog->portableReferences($type, $list($type));
            foreach ($list($type) as $id) {
                if (isset($records[$id])) {
                    $result[$key][] = ['ref' => $refs[$id], 'slug' => $records[$id]['slug'], 'name' => $records[$id]['name']];
                }
            }
        }
        foreach ($list('banner') as $id) {
            $banner = $banners[$id] ?? null;
            if ($banner === null) {
                continue;
            }
            $fields = [];
            foreach (PortableTemplate::BANNER_FIELDS as $field) {
                $fields[$field] = $field === 'placement' ? $banner->placement->value : $banner->{$field};
            }
            $result['banners'][] = ['ref' => $refs[$id]] + $fields + [
                'image' => $refs[$banner->desktop_media_id] ?? null,
                'mobile_image' => is_string($banner->mobile_media_id) ? ($refs[$banner->mobile_media_id] ?? null) : null,
            ];
        }
        foreach (Menu::query()->whereIn('id', $list('menu'))->get() as $menu) {
            $result['menus'][] = ['ref' => $refs[$menu->id], 'name' => $menu->name, 'location' => $menu->location?->value];
        }
        foreach ($this->blog->categories($list('blog_category')) as $id => $c) {
            $result['blog_categories'][] = ['ref' => $refs[$id], 'slug' => $c['slug'], 'name' => $c['name']];
        }
        $promotionIds = $list('promotion');
        foreach ($this->promotions->countdowns($promotionIds) + $this->promotions->discounts($promotionIds) as $id => $p) {
            $result['promotions'][] = ['ref' => $refs[$id], 'name' => $p['name']];
        }

        return $result;
    }

    /**
     * What kind of page the file holds (page = the home page).
     */
    private static function keyKind(BuilderDocument $document): string
    {
        return match (true) {
            $document->landingSlug() !== null => 'landing',
            $document->cmsPageId() !== null => 'cms',
            $document->templateKey() !== null => 'template',
            default => $document->kind,
        };
    }
}
