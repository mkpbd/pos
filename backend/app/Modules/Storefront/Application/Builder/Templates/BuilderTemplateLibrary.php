<?php

namespace App\Modules\Storefront\Application\Builder\Templates;

use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use RuntimeException;

/**
 * B5: the built-in store builder templates — files that ship with the code in
 * `resources/builder-templates/`: `manifest.json` lists every template `{id, scope (section |
 * page | site), preset (default | vegan | handmade | classic | kids | null), category, name,
 * description, thumbnail (a path the admin app serves, or null), preview? (B7: a tall full-page
 * image the admin app serves, `/builder-templates/<id>-full.jpg`; site templates only, null when
 * absent), allowed_in (document contexts), requires (banners | menus | promotions | blog | products
 * — what it needs to show fully)}` and `<id>.json` holds its
 * content in the portable format (PortableTemplate): `{schema_version: 1, sections: [...]}`, or
 * for a site template `{schema_version: 1, theme: {preset}, parts: {home, header, footer,
 * listing_top: {sections}}}`. The images come from the demo store photos
 * (`database/seeders/demo-themes/images/`, alt text from its manifest).
 */
class BuilderTemplateLibrary
{
    /** Site template part => the document context it is used in. */
    public const SITE_PARTS = ['home' => 'page', 'header' => 'header', 'footer' => 'footer', 'listing_top' => 'zone'];

    /** @var list<array<string, mixed>>|null */
    private ?array $manifest = null;

    /** @var array<string, array{alt: ?string}>|null */
    private ?array $assets = null;

    public static function directory(): string
    {
        return resource_path('builder-templates');
    }

    public static function assetDirectory(): string
    {
        return database_path('seeders/demo-themes/images');
    }

    /**
     * Every built-in template's metadata, in manifest order (B7: the site templates in the order
     * the admin's demo looks show them, the kids look first).
     *
     * @return list<array<string, mixed>>
     */
    public function all(): array
    {
        if ($this->manifest === null) {
            $manifest = $this->json(self::directory().'/manifest.json');
            $this->manifest = array_values(array_map(fn (array $t) => $t + ['thumbnail' => null, 'preview' => null, 'requires' => []], $manifest['templates'] ?? []));
        }

        return $this->manifest;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function find(string $id): ?array
    {
        foreach ($this->all() as $template) {
            if ($template['id'] === $id) {
                return $template;
            }
        }

        return null;
    }

    /**
     * The site template of a preset, or null.
     *
     * @return array<string, mixed>|null
     */
    public function site(string $preset): ?array
    {
        foreach ($this->all() as $template) {
            if ($template['scope'] === 'site' && $template['preset'] === $preset) {
                return $template;
            }
        }

        return null;
    }

    /**
     * The template's portable content.
     *
     * @return array<string, mixed>
     */
    public function content(string $id): array
    {
        if ($this->find($id) === null || preg_match('/^[a-z0-9-]{2,80}$/', $id) !== 1) {
            throw new RuntimeException("Unknown builder template [{$id}].");
        }

        return $this->json(self::directory()."/{$id}.json");
    }

    /**
     * The portable sections of a template in a document context: a section or page template's
     * sections, or a site template's part for the context (home → page, header, footer,
     * listing top → zone).
     *
     * @return list<array<string, mixed>>
     */
    public function sections(string $id, string $context): array
    {
        $template = $this->find($id);
        $content = $this->content($id);
        if ($template['scope'] !== 'site') {
            return $content['sections'] ?? [];
        }
        $part = array_search($context, self::SITE_PARTS, true);

        return $part === false ? [] : ($content['parts'][$part]['sections'] ?? []);
    }

    /**
     * The absolute path of a shipped image, or null for an unknown or malformed asset key.
     */
    public function assetPath(string $asset): ?string
    {
        if (preg_match(PortableTemplate::ASSET_PATTERN, $asset) !== 1) {
            return null;
        }
        $path = self::assetDirectory().'/'.$asset;

        return is_file($path) ? $path : null;
    }

    /**
     * The alt text of a shipped image (the demo photos' manifest), or null.
     */
    public function assetAlt(string $asset): ?string
    {
        $this->assets ??= $this->json(self::assetDirectory().'/manifest.json');
        $alt = $this->assets[$asset]['alt'] ?? null;

        return is_string($alt) ? $alt : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function json(string $path): array
    {
        if (! is_file($path)) {
            throw new RuntimeException("Builder template file missing: {$path}");
        }

        return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    }
}
