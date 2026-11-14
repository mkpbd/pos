<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\StorefrontFont;
use Illuminate\Support\Collection;

/**
 * B10: the organization's own fonts (current tenant) — which exist, what the storefront needs
 * to load them, and where the theme uses them (the live theme and the theme draft).
 */
class CustomFonts
{
    public const LIMIT = 4;

    public function __construct(private readonly StorefrontConfig $config) {}

    /**
     * @return Collection<int, StorefrontFont>
     */
    public function all(): Collection
    {
        return StorefrontFont::query()->orderBy('name')->orderBy('id')->get();
    }

    /**
     * The subset of the given font ids (uuids) the organization has.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function existing(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, fn ($id) => is_string($id) && preg_match('/^[0-9a-f-]{36}$/', $id) === 1)));

        return $ids === [] ? [] : StorefrontFont::query()->whereIn('id', $ids)->pluck('id')->all();
    }

    /**
     * The theme's fonts as the storefront loads them: the font of each role (Bangla roles
     * effective, ThemeSchema::fonts) and the custom fonts those roles use.
     *
     * @param  array<string, mixed>  $settings  normalized theme
     * @return array{heading: string, body: string, bangla_heading: string, bangla_body: string, custom: list<array<string, mixed>>}
     */
    public function themeFonts(array $settings): array
    {
        $roles = ThemeSchema::fonts($settings);
        $ids = [];
        foreach ($roles as $font) {
            if (preg_match(ThemeSchema::CUSTOM_FONT_PATTERN, $font) === 1) {
                $ids[] = substr($font, strlen(ThemeSchema::CUSTOM_FONT_PREFIX));
            }
        }
        $ids = array_values(array_unique($ids));
        $fonts = $ids === [] ? collect() : StorefrontFont::query()->whereIn('id', $ids)->get()->keyBy('id');

        return $roles + ['custom' => array_values(array_filter(array_map(
            fn (string $id) => $fonts->has($id) ? self::face($fonts[$id]) : null,
            $ids,
        )))];
    }

    /**
     * Where the theme uses a font: `used_by` (`live_theme`, `theme_draft`) and the roles.
     *
     * @return array{used_by: list<string>, roles: list<string>}
     */
    public function usage(string $fontId): array
    {
        $usedBy = [];
        $roles = [];
        $live = ThemeSchema::customFontRoles($this->config->theme()->settings, $fontId);
        if ($live !== []) {
            $usedBy[] = 'live_theme';
            $roles = $live;
        }
        $draft = BuilderDocument::query()->where('kind', BuilderDocument::KIND_THEME)->where('key', BuilderDocument::THEME)->value('draft');
        if (is_string($draft)) {
            $draft = json_decode($draft, true);
        }
        $draftRoles = is_array($draft) ? ThemeSchema::customFontRoles(ThemeSchema::normalize($draft), $fontId) : [];
        if ($draftRoles !== []) {
            $usedBy[] = 'theme_draft';
            $roles = [...$roles, ...$draftRoles];
        }
        $roles = array_values(array_intersect(array_keys(ThemeSchema::FONT_ROLES), $roles));

        return ['used_by' => $usedBy, 'roles' => $roles];
    }

    /**
     * What `@font-face` needs.
     *
     * @return array{id: string, name: string, family: string, url: string, format: string, weight_min: int, weight_max: int}
     */
    public static function face(StorefrontFont $font): array
    {
        return [
            'id' => $font->key(),
            'name' => $font->name,
            'family' => $font->family(),
            'url' => $font->url(),
            'format' => 'woff2',
            'weight_min' => $font->weight_min,
            'weight_max' => $font->weight_max,
        ];
    }
}
