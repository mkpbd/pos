<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\Builder\Templates\TemplateReferenceResolver;
use App\Modules\Storefront\Domain\ThemePresets;
use Illuminate\Support\Facades\Validator;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * B5: every built-in template (resources/builder-templates) — the manifest is complete, each
 * template converts with a fake resolver into content that BuilderDocumentSchema accepts in
 * every context it is offered in (with and without the store's menus), every photo exists, node
 * ids are unique, banners are valid and no template names another organization's records.
 */
class BuilderTemplatesTest extends TestCase
{
    private static function directory(): string
    {
        return dirname(__DIR__, 5).'/resources/builder-templates';
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function manifest(): array
    {
        return json_decode((string) file_get_contents(self::directory().'/manifest.json'), true, flags: JSON_THROW_ON_ERROR)['templates'];
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function templates(): array
    {
        $result = [];
        foreach (self::manifest() as $template) {
            $result[$template['id']] = [$template['id']];
        }

        return $result;
    }

    private function resolver(bool $withMenus = true): TemplateReferenceResolver
    {
        return new class($withMenus) implements TemplateReferenceResolver
        {
            /** @var list<string> */
            public array $calls = [];

            public function __construct(private readonly bool $withMenus) {}

            private function uuid(string $seed): string
            {
                $h = md5($seed);

                return substr($h, 0, 8).'-'.substr($h, 8, 4).'-4'.substr($h, 13, 3).'-a'.substr($h, 17, 3).'-'.substr($h, 20, 12);
            }

            public function media(string $asset): string
            {
                $this->calls[] = "media:{$asset}";

                return $this->uuid('media'.$asset);
            }

            public function banner(array $attributes): string
            {
                $this->calls[] = 'banner:'.$attributes['name'];

                return $this->uuid('banner'.json_encode($attributes));
            }

            public function menu(string $ref): ?string
            {
                return $this->withMenus ? $this->uuid('menu'.$ref) : null;
            }
        };
    }

    private function newId(): callable
    {
        $n = 0;

        return function (string $prefix) use (&$n): string {
            return $prefix.'_t'.(++$n);
        };
    }

    public function test_the_manifest_lists_every_template_file_with_complete_metadata(): void
    {
        $manifest = self::manifest();
        $ids = array_column($manifest, 'id');
        $this->assertSame(array_values(array_unique($ids)), $ids, 'Template ids are unique.');

        $files = array_map(fn (string $f) => basename($f, '.json'), glob(self::directory().'/*.json'));
        $this->assertEqualsCanonicalizing([...$ids, 'manifest'], $files, 'Every template has a file and every file is listed.');

        foreach ($manifest as $t) {
            $this->assertMatchesRegularExpression('/^[a-z0-9-]{2,80}$/', $t['id']);
            $this->assertSame(['id', 'scope', 'preset', 'category', 'name', 'description', 'thumbnail', 'allowed_in', 'requires'], array_keys($t), $t['id']);
            $this->assertContains($t['scope'], ['section', 'page', 'site'], $t['id']);
            $this->assertContains($t['preset'], [null, 'vegan', 'handmade', 'classic'], $t['id']);
            $this->assertMatchesRegularExpression('/^[a-z]{3,20}$/', $t['category'], $t['id']);
            $this->assertNotSame('', trim($t['name']));
            $this->assertLessThanOrEqual(120, mb_strlen($t['name']));
            $this->assertGreaterThan(20, mb_strlen($t['description']), $t['id']);
            $this->assertLessThanOrEqual(300, mb_strlen($t['description']));
            if ($t['thumbnail'] !== null) {
                $this->assertMatchesRegularExpression('#^/builder-templates/'.preg_quote($t['id'], '#').'\.(webp|png)$#', $t['thumbnail']);
            }
            $this->assertNotEmpty($t['allowed_in'], $t['id']);
            $this->assertSame([], array_diff($t['allowed_in'], ElementRegistry::CONTEXTS), $t['id']);
            $this->assertSame([], array_diff($t['requires'], ['banners', 'menus', 'promotions', 'blog']), $t['id']);
        }

        // The library: ≥ 24 section templates, 6+ per preset and neutral ones; the five pages; one site per preset.
        $sections = array_filter($manifest, fn (array $t) => $t['scope'] === 'section');
        $this->assertGreaterThanOrEqual(24, count($sections));
        foreach (['vegan', 'handmade', 'classic', null] as $preset) {
            $this->assertGreaterThanOrEqual(6, count(array_filter($sections, fn (array $t) => $t['preset'] === $preset)), (string) $preset);
        }
        $pages = array_values(array_filter($manifest, fn (array $t) => $t['scope'] === 'page'));
        $this->assertEqualsCanonicalizing(['about', 'contact', 'faq', 'sale', 'collection'], array_column($pages, 'category'));
        $sites = array_values(array_filter($manifest, fn (array $t) => $t['scope'] === 'site'));
        $this->assertEqualsCanonicalizing(['vegan', 'handmade', 'classic'], array_column($sites, 'preset'));
        foreach ($sites as $site) {
            $this->assertSame(['page', 'header', 'footer', 'zone'], $site['allowed_in']);
        }
        // Categories the editor groups by.
        foreach (['hero', 'features', 'categories', 'products', 'promo', 'testimonials', 'story', 'cta', 'newsletter', 'faq', 'countdown', 'brands', 'video'] as $category) {
            $this->assertNotEmpty(array_filter($sections, fn (array $t) => $t['category'] === $category), $category);
        }
    }

    #[DataProvider('templates')]
    public function test_the_template_is_valid_in_every_context_it_is_offered_in(string $id): void
    {
        $library = app(BuilderTemplateLibrary::class);
        $meta = $library->find($id);
        $content = $library->content($id);
        $this->assertSame(1, $content['schema_version']);

        if ($meta['scope'] === 'site') {
            $this->assertSame(['preset' => $meta['preset']], $content['theme']);
            $this->assertTrue(ThemePresets::exists($meta['preset']));
            $this->assertSame(array_keys(BuilderTemplateLibrary::SITE_PARTS), array_keys($content['parts']));
            $parts = array_map(fn (array $part) => $part['sections'], $content['parts']);
            $contexts = BuilderTemplateLibrary::SITE_PARTS;
        } else {
            $this->assertSame(['schema_version', 'sections'], array_keys($content));
            $parts = ['sections' => $content['sections']];
            $contexts = null;
        }

        $allIds = [];
        foreach ($parts as $part => $sections) {
            $this->assertNotEmpty($sections, "{$id} {$part}");
            foreach (PortableTemplate::nodeIds($sections) as $nodeId) {
                $this->assertIsString($nodeId);
                $this->assertMatchesRegularExpression('/'.BuilderDocumentSchema::ID_PATTERN.'/', $nodeId);
                $allIds[] = $nodeId;
            }
            $this->assertPortable($id, $sections);

            foreach ($contexts === null ? $meta['allowed_in'] : [$contexts[$part]] as $context) {
                foreach ([true, false] as $withMenus) {
                    $resolver = $this->resolver($withMenus);
                    $concrete = PortableTemplate::concrete($sections, $resolver, $this->newId());
                    try {
                        $document = BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => $concrete], $context);
                    } catch (InvalidBuilderDocument $e) {
                        $this->fail("{$id} ({$part}) is invalid in {$context}: ".json_encode($e->errors, JSON_UNESCAPED_SLASHES));
                    }
                    $this->assertNotEmpty($document['sections']);
                    if ($withMenus) {
                        $this->assertCount(count($sections), $document['sections']);
                        $this->assertSame(count(PortableTemplate::nodeIds($sections)), count(PortableTemplate::nodeIds($concrete)), "{$id}: nothing is dropped with menus");
                        // Every photo (banner photos included) goes through the resolver.
                        $this->assertEqualsCanonicalizing(
                            array_map(fn (string $a) => "media:{$a}", PortableTemplate::assets($sections)),
                            array_values(array_unique(array_filter($resolver->calls, fn (string $c) => str_starts_with($c, 'media:')))),
                        );
                        $this->assertCount(count(PortableTemplate::banners($sections)), array_filter($resolver->calls, fn (string $c) => str_starts_with($c, 'banner:')));
                    }
                    // No portable reference survives.
                    $json = json_encode($concrete);
                    $this->assertStringNotContainsString('"asset"', $json);
                    $this->assertStringNotContainsString('"menu_ref"', $json);
                    $this->assertStringNotContainsString('"when_menu"', $json);
                    $this->assertStringNotContainsString('"banner":', $json);
                }
            }
        }
        $this->assertSame(array_values(array_unique($allIds)), $allIds, "{$id}: node ids are unique within the template");

        if ($meta['scope'] !== 'site') {
            // Offered exactly where it is valid among page, content page and shop zones.
            $all = $content['sections'];
            foreach (['page', 'cms', 'zone'] as $context) {
                $valid = true;
                try {
                    BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => PortableTemplate::concrete($all, $this->resolver(), $this->newId())], $context);
                } catch (InvalidBuilderDocument) {
                    $valid = false;
                }
                if (! $valid) {
                    $this->assertNotContains($context, $meta['allowed_in'], $id);
                }
            }
        }

        // `requires` names what the template needs.
        $json = json_encode($content);
        $this->assertSame(str_contains($json, '"banner":{'), in_array('banners', $meta['requires'], true), "{$id} banners");
        $this->assertSame(str_contains($json, '"menu_ref"'), in_array('menus', $meta['requires'], true), "{$id} menus");
        $this->assertSame(str_contains($json, '"type":"hot_deals"'), in_array('promotions', $meta['requires'], true), "{$id} promotions");
        $this->assertSame(str_contains($json, '"type":"blog_posts"'), in_array('blog', $meta['requires'], true), "{$id} blog");
    }

    public function test_menu_references_are_resolved_or_left_out(): void
    {
        $library = app(BuilderTemplateLibrary::class);
        $footer = $library->sections('site-vegan', 'footer');
        $types = fn (array $sections) => PortableTemplate::elementTypes($sections);

        $with = PortableTemplate::concrete($footer, $this->resolver(true), $this->newId());
        $without = PortableTemplate::concrete($footer, $this->resolver(false), $this->newId());
        $this->assertContains('menu', $types($with));
        $this->assertNotContains('menu', $types($without));
        // The "Information" heading goes with its menu; the rest of the footer stays.
        $headings = fn (array $sections) => count(array_filter(json_decode((string) json_encode($sections), true)[0]['columns'][1]['elements'], fn (array $e) => $e['type'] === 'heading'));
        $this->assertSame(1, $headings($with));
        $this->assertSame(0, $headings($without));
        $this->assertContains('copyright', $types($without));

        // A header without a main menu keeps its first row only.
        $header = $library->sections('site-classic', 'header');
        $this->assertCount(2, PortableTemplate::concrete($header, $this->resolver(true), $this->newId()));
        $this->assertCount(1, PortableTemplate::concrete($header, $this->resolver(false), $this->newId()));
    }

    /**
     * No ids of any organization; catalog data from sources only; every photo ships with the code.
     *
     * @param  list<array<string, mixed>>  $sections
     */
    private function assertPortable(string $id, array $sections): void
    {
        $library = app(BuilderTemplateLibrary::class);
        $json = (string) json_encode($sections);
        $this->assertDoesNotMatchRegularExpression('/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i', $json, "{$id} names no record ids");
        foreach (['menu_id', 'product_id', 'item_id', 'category_id', 'promotion_id', 'media_id', 'avatar_media_id', 'image_media_id'] as $key) {
            // Present only as null (or, for media, as an asset).
            preg_match_all('/"'.$key.'":(\{[^}]*\}|[^,}\]]+)/', $json, $m);
            foreach ($m[1] as $value) {
                $this->assertTrue($value === 'null' || str_starts_with($value, '{"asset":'), "{$id}: {$key} = {$value}");
            }
        }
        $this->assertStringNotContainsString('"source":"manual"', $json, $id);
        $this->assertStringNotContainsString('"source":"category"', $json, $id);
        $this->assertStringNotContainsString('"custom_html"', $json, $id);

        foreach (PortableTemplate::assets($sections) as $asset) {
            $this->assertMatchesRegularExpression(PortableTemplate::ASSET_PATTERN, $asset);
            $this->assertNotNull($library->assetPath($asset), "{$id}: {$asset} exists");
            $this->assertNotNull($library->assetAlt($asset), "{$id}: {$asset} has alt text");
            $this->assertLessThanOrEqual(5 * 1024 * 1024, filesize((string) $library->assetPath($asset)));
        }
        foreach (PortableTemplate::banners($sections) as $banner) {
            $validator = Validator::make($banner, PortableTemplate::bannerRules());
            $this->assertFalse($validator->fails(), "{$id}: banner {$banner['name']}: ".json_encode($validator->errors()->toArray()));
            $this->assertSame([], array_diff(array_keys($banner), [...PortableTemplate::BANNER_FIELDS, 'image', 'mobile_image']), $id);
        }
    }
}
