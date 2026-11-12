<?php

namespace App\Modules\Storefront\Domain\Builder\Templates;

use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\SectionConfigRules;
use Closure;
use Illuminate\Validation\Rule;

/**
 * B5: the portable format of built-in store builder templates. A template's sections are
 * schema-v1 nodes whose references name nothing of any organization:
 *
 * - images: `{"asset": "vegan/banner-hero-1.jpg"}` wherever a media id goes (an image element's
 *   `media_id`, a background image's `media_id`, a testimonial's `avatar_media_id`, the
 *   newsletter's `image_media_id`) — a file shipped in `database/seeders/demo-themes/images/`;
 * - banners of a hero slider / banner grid: `items: [{"item_type": "banner", "banner": {placement,
 *   name, kicker, title, subtitle, button_label, link_url, secondary_button_label,
 *   secondary_link_url, text_color, text_position, translations, image: {asset}, mobile_image?}}]`;
 * - menus: a menu element has `props.menu_ref` (`main`, `footer` = the first footer column,
 *   `footer_1` … `footer_3`) instead of `menu_id`; any node may carry `when_menu: <ref>` to be
 *   left out when the organization has no such menu (e.g. the heading above a footer menu);
 * - catalog data comes from sources only (featured, best sellers, new arrivals, on sale, top-level
 *   categories, all brands; hot deals of every countdown promotion), never from hand-picked ids.
 *
 * concrete() turns such sections into ordinary ones through a TemplateReferenceResolver and
 * gives every node a fresh id; the caller then validates them like any draft content.
 */
final class PortableTemplate
{
    public const ASSET_PATTERN = '/^(vegan|handmade|classic)\/[a-z0-9][a-z0-9-]*\.(jpg|jpeg|png|webp)$/';

    /** Menu references: a menu location; `footer` = the first footer column that has a menu. */
    public const MENU_REFS = ['main', 'footer', 'footer_1', 'footer_2', 'footer_3'];

    /** Fields a template banner may set (besides `image` / `mobile_image`). */
    public const BANNER_FIELDS = [
        'placement', 'name', 'kicker', 'title', 'subtitle', 'button_label', 'link_url',
        'secondary_button_label', 'secondary_link_url', 'text_color', 'text_position', 'translations',
    ];

    /**
     * Ordinary sections for the current organization: references resolved, every node with a
     * fresh id from `$newId(prefix)` (`s`, `c` or `e`). Menu elements (and nodes marked
     * `when_menu`) whose menu the organization lacks are left out.
     *
     * @param  list<array<string, mixed>>  $sections  portable
     * @param  callable(string): string  $newId
     * @return list<array<string, mixed>>
     */
    public static function concrete(array $sections, TemplateReferenceResolver $resolver, callable $newId): array
    {
        $result = [];
        foreach ($sections as $section) {
            $node = self::node($section, 'section', $resolver, $newId);
            if ($node !== null) {
                $result[] = $node;
            }
        }

        return $result;
    }

    /**
     * Every asset key the sections use (images and banner images), unique.
     *
     * @param  list<array<string, mixed>>  $sections
     * @return list<string>
     */
    public static function assets(array $sections): array
    {
        $assets = [];
        array_walk_recursive($sections, function ($value, $key) use (&$assets) {
            if ($key === 'asset' && is_string($value)) {
                $assets[] = $value;
            }
        });

        return array_values(array_unique($assets));
    }

    /**
     * Every portable banner of the sections.
     *
     * @param  list<array<string, mixed>>  $sections
     * @return list<array<string, mixed>>
     */
    public static function banners(array $sections): array
    {
        $banners = [];
        self::visit($sections, function (array $node) use (&$banners) {
            foreach ($node['props']['items'] ?? [] as $item) {
                if (is_array($item) && is_array($item['banner'] ?? null)) {
                    $banners[] = $item['banner'];
                }
            }
        });

        return $banners;
    }

    /**
     * Every node id (sections, columns, elements), in order — duplicates included.
     *
     * @param  list<array<string, mixed>>  $sections
     * @return list<mixed>
     */
    public static function nodeIds(array $sections): array
    {
        $ids = [];
        self::visit($sections, function (array $node) use (&$ids) {
            $ids[] = $node['id'] ?? null;
        });

        return $ids;
    }

    /**
     * Every element type used.
     *
     * @param  list<array<string, mixed>>  $sections
     * @return list<string>
     */
    public static function elementTypes(array $sections): array
    {
        $types = [];
        self::visit($sections, function (array $node, string $kind) use (&$types) {
            if ($kind === 'element' && is_string($node['type'] ?? null)) {
                $types[] = $node['type'];
            }
        });

        return array_values(array_unique($types));
    }

    /**
     * Validation rules of a template banner (the banner API's rules, image as an asset).
     *
     * @return array<string, mixed>
     */
    public static function bannerRules(): array
    {
        $link = SectionConfigRules::safeLink();
        $rules = [
            'placement' => ['required', Rule::in([BannerPlacement::HeroSlider->value, BannerPlacement::HomePromo->value])],
            'name' => ['required', 'string', 'max:80'],
            'kicker' => ['sometimes', 'nullable', 'string', 'max:60'],
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'link_url' => ['sometimes', 'nullable', $link, 'required_with:button_label'],
            'button_label' => ['sometimes', 'nullable', 'string', 'max:40'],
            'secondary_link_url' => ['sometimes', 'nullable', $link, 'required_with:secondary_button_label'],
            'secondary_button_label' => ['sometimes', 'nullable', 'string', 'max:40', 'required_with:secondary_link_url'],
            'text_color' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'text_position' => ['sometimes', Rule::in(['left', 'center', 'right'])],
            'image' => ['required', 'array:asset'],
            'image.asset' => ['required', 'string', 'regex:'.self::ASSET_PATTERN],
            'mobile_image' => ['sometimes', 'array:asset'],
            'mobile_image.asset' => ['required_with:mobile_image', 'string', 'regex:'.self::ASSET_PATTERN],
            'translations' => ['sometimes', 'array:'.implode(',', LocaleContext::TRANSLATABLE)],
        ];
        foreach (LocaleContext::TRANSLATABLE as $locale) {
            $rules["translations.{$locale}"] = ['sometimes', 'array:kicker,title,subtitle,button_label,secondary_button_label'];
            foreach (['kicker' => 60, 'title' => 120, 'subtitle' => 255, 'button_label' => 40, 'secondary_button_label' => 40] as $field => $max) {
                $rules["translations.{$locale}.{$field}"] = ['sometimes', 'string', "max:{$max}"];
            }
        }

        return $rules;
    }

    /**
     * @param  array<string, mixed>  $node
     * @param  callable(string): string  $newId
     * @return array<string, mixed>|null
     */
    private static function node(array $node, string $kind, TemplateReferenceResolver $resolver, callable $newId): ?array
    {
        if (isset($node['when_menu'])) {
            if (! is_string($node['when_menu']) || $resolver->menu($node['when_menu']) === null) {
                return null;
            }
            unset($node['when_menu']);
        }

        $node['id'] = $newId(match ($kind) {
            'section' => 's',
            'column' => 'c',
            default => 'e',
        });

        if ($kind === 'element') {
            $props = is_array($node['props'] ?? null) ? $node['props'] : [];
            if (($node['type'] ?? null) === 'menu' && array_key_exists('menu_ref', $props)) {
                $menuId = is_string($props['menu_ref']) ? $resolver->menu($props['menu_ref']) : null;
                if ($menuId === null) {
                    return null;
                }
                unset($props['menu_ref']);
                $props['menu_id'] = $menuId;
            }
            if (is_string($node['type'] ?? null) && ElementRegistry::sectionType($node['type'])?->bannerPlacement() !== null && is_array($props['items'] ?? null)) {
                $props['items'] = array_map(fn ($item) => is_array($item) && is_array($item['banner'] ?? null)
                    ? ['item_type' => 'banner', 'item_id' => $resolver->banner(self::bannerAttributes($item['banner'], $resolver))]
                    : $item, $props['items']);
            }
            if (isset($node['props'])) {
                $node['props'] = self::assetsToMedia($props, $resolver);
            }
        }
        if (isset($node['style'])) {
            $node['style'] = self::assetsToMedia($node['style'], $resolver);
        }

        $children = match ($kind) {
            'section' => 'columns',
            'column' => 'elements',
            default => ElementRegistry::children((string) ($node['type'] ?? '')),
        };
        if ($children !== null && is_array($node[$children] ?? null)) {
            $list = [];
            foreach ($node[$children] as $child) {
                if (! is_array($child)) {
                    $list[] = $child;

                    continue;
                }
                $converted = self::node($child, $children === 'columns' ? 'column' : 'element', $resolver, $newId);
                if ($converted !== null) {
                    $list[] = $converted;
                }
            }
            $node[$children] = $list;
        }

        return $node;
    }

    /**
     * The banner API's attributes of a template banner (its image resolved to a media id).
     *
     * @param  array<string, mixed>  $banner
     * @return array<string, mixed>
     */
    private static function bannerAttributes(array $banner, TemplateReferenceResolver $resolver): array
    {
        $attributes = array_intersect_key($banner, array_flip(self::BANNER_FIELDS));
        $attributes['desktop_media_id'] = is_string($banner['image']['asset'] ?? null) ? $resolver->media($banner['image']['asset']) : null;
        if (is_string($banner['mobile_image']['asset'] ?? null)) {
            $attributes['mobile_media_id'] = $resolver->media($banner['mobile_image']['asset']);
        }

        return $attributes;
    }

    /**
     * Replaces every `{"asset": "<key>"}` value with the media id of the asset.
     */
    private static function assetsToMedia(mixed $value, TemplateReferenceResolver $resolver): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (array_keys($value) === ['asset'] && is_string($value['asset'])) {
            return $resolver->media($value['asset']);
        }

        return array_map(fn ($v) => self::assetsToMedia($v, $resolver), $value);
    }

    /**
     * Calls `$visit(node, kind)` for every node (sections, columns, elements, inner rows' columns).
     *
     * @param  list<array<string, mixed>>  $sections
     * @param  Closure(array<string, mixed>, string): void  $visit
     */
    private static function visit(array $sections, Closure $visit): void
    {
        $walk = function (array $nodes, string $kind) use (&$walk, $visit): void {
            foreach ($nodes as $node) {
                if (! is_array($node)) {
                    continue;
                }
                $visit($node, $kind);
                $children = match ($kind) {
                    'section' => ['columns', 'column'],
                    'column' => ['elements', 'element'],
                    default => ElementRegistry::children((string) ($node['type'] ?? '')) === 'columns' ? ['columns', 'column'] : null,
                };
                if ($children !== null && is_array($node[$children[0]] ?? null)) {
                    $walk($node[$children[0]], $children[1]);
                }
            }
        };
        $walk($sections, 'section');
    }
}
