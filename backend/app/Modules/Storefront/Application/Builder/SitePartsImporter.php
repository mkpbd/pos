<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\MenuLocation;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use Illuminate\Support\Str;

/**
 * "Design the header / footer" starting from today's (B4, `from: current`): a document that
 * reproduces the theme's default (standard / columns) layout with the builder's site elements,
 * reading the same data the classic header and footer show (theme, menus).
 *
 * - Header: logo | search | language switch | account | wishlist | cart in one row (centred
 *   vertically), then the main menu (dropdowns) when the store has one.
 * - Footer: the logo with the about text and payment icons, one column per footer menu (its name
 *   as heading, the items as a list), "Contact us" with the contact details and social icons;
 *   then the copyright line.
 *
 * The result is a raw document; the caller prepares (validates) it like any other content.
 */
class SitePartsImporter
{
    public function __construct(private readonly StorefrontConfig $config) {}

    /**
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     */
    public function header(): array
    {
        $document = BuilderDocumentSchema::blank();
        $document['sections'][] = $this->section([
            [16, [$this->element('logo', ['height' => 48, 'link' => ['url' => '/']])]],
            [44, [$this->element('search_box', ElementRegistry::defaults('search_box'))]],
            [16, [$this->element('language_switch', ElementRegistry::defaults('language_switch'))]],
            [8, [$this->element('account_link', ElementRegistry::defaults('account_link'))]],
            [8, [$this->element('wishlist_link', ElementRegistry::defaults('wishlist_link'))]],
            [8, [$this->element('cart_icon', ElementRegistry::defaults('cart_icon'))]],
        ], ['base' => ['layout' => ['align' => 'center']]]);

        $main = Menu::query()->where('location', MenuLocation::Main)->first();
        if ($main !== null) {
            $document['sections'][] = $this->section([
                [100, [$this->element('menu', ['menu_id' => $main->id, 'layout' => 'horizontal', 'show_children' => 'dropdown'])]],
            ]);
        }

        return $document;
    }

    /**
     * @return array{schema_version: int, sections: list<array<string, mixed>>}
     */
    public function footer(): array
    {
        $about = $this->config->theme()->settings['footer']['about'] ?? null;
        $brand = [$this->element('logo', ['height' => 40, 'link' => ['url' => '/']])];
        if (is_string($about) && trim($about) !== '') {
            $brand[] = $this->element('text', ['html' => '<p>'.preg_replace('/\R/u', '<br>', e(trim($about))).'</p>']);
        }
        $brand[] = $this->element('payment_icons', ElementRegistry::defaults('payment_icons'));

        $columns = [$brand];
        $menus = Menu::query()->whereIn('location', [MenuLocation::Footer1, MenuLocation::Footer2, MenuLocation::Footer3])->get()
            ->sortBy(fn (Menu $menu) => array_search($menu->location, MenuLocation::cases(), true));
        foreach ($menus as $menu) {
            $columns[] = [
                $this->element('heading', ['text' => $menu->name, 'level' => 2, 'link' => null]),
                $this->element('menu', ['menu_id' => $menu->id, 'layout' => 'vertical', 'show_children' => 'none']),
            ];
        }
        $columns[] = [
            $this->element('heading', ['text' => 'Contact us', 'level' => 2, 'link' => null]),
            $this->element('contact_block', ElementRegistry::defaults('contact_block')),
            $this->element('social_icons', ElementRegistry::defaults('social_icons')),
        ];

        // Equal columns whose widths add up to 100 (the last one takes the rounding).
        $count = count($columns);
        $width = floor(10000 / $count) / 100;
        $row = [];
        foreach ($columns as $i => $elements) {
            // Two per row on tablets, stacked on phones (like the classic footer).
            $row[] = [$i === $count - 1 ? round(100 - $width * ($count - 1), 2) : $width, $elements, ['tablet' => 50, 'mobile' => 100]];
        }

        $document = BuilderDocumentSchema::blank();
        $document['sections'][] = $this->section($row);
        $document['sections'][] = $this->section([
            [100, [$this->element('copyright', ElementRegistry::defaults('copyright'))]],
        ]);

        return $document;
    }

    /**
     * A boxed section with columns `[width %, elements, other widths?]`.
     *
     * @param  list<array{0: int|float, 1: list<array<string, mixed>>, 2?: array<string, int>}>  $columns
     * @param  array<string, mixed>  $style
     * @return array<string, mixed>
     */
    private function section(array $columns, array $style = []): array
    {
        return [
            'id' => $this->id('s'),
            'type' => 'section',
            'props' => ['layout' => 'boxed', 'anchor' => null],
            'style' => $style,
            'columns' => array_map(fn (array $column) => [
                'id' => $this->id('c'),
                'type' => 'column',
                'width' => ['base' => $column[0] == (int) $column[0] ? (int) $column[0] : $column[0]] + ($column[2] ?? []),
                'style' => [],
                'elements' => $column[1],
            ], $columns),
        ];
    }

    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    private function element(string $type, array $props): array
    {
        return ['id' => $this->id('e'), 'type' => $type, 'props' => $props];
    }

    private function id(string $prefix): string
    {
        return $prefix.'_'.Str::lower(Str::random(10));
    }
}
