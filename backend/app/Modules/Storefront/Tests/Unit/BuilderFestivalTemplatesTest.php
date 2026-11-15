<?php

namespace App\Modules\Storefront\Tests\Unit;

use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\Builder\Templates\TemplateReferenceResolver;
use App\Modules\Storefront\Domain\ThemePresets;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * B17: the festival packs — for each of the ten occasions a landing page, a home hero and an
 * announcement bar (`festival-<key>-landing|hero|bar`, category `festival`, no thumbnails, no
 * photos). Each validates and instantiates in every context it is offered in (with and without
 * the store's coupon), keeps every style it sets, has Bangla for every text, and every text
 * colour / background pair it sets passes WCAG AA under every theme preset (4.5:1; 3:1 for
 * large headings). Ekushey carries no sale wording; the national days only a modest offer.
 */
class BuilderFestivalTemplatesTest extends TestCase
{
    public const OCCASIONS = [
        'eid-ul-fitr', 'eid-ul-adha', 'ramadan', 'durga-puja', 'pohela-boishakh',
        'ekushey', 'independence-day', 'victory-day', 'winter-sale', 'eleven-eleven',
    ];

    /** Occasions without a sale (tribute) or with a modest thank-you offer only. */
    private const TRIBUTE = ['ekushey'];

    private const MODEST = ['independence-day', 'victory-day'];

    /** Elements whose texts inherit the colour set on a section / column (or draw nothing). */
    private const INHERITING = ['heading', 'text', 'bangla_date'];

    /** Elements that may sit on a colour the template sets (their own colours are theme pairs). */
    private const ON_COLOUR = ['heading', 'text', 'bangla_date', 'button', 'ornament', 'spacer', 'inner_row', 'countdown', 'discount'];

    /** Theme roles that count as the store's own ground (checked by the theme preset tests). */
    private const THEME_GROUNDS = ['theme:canvas', 'theme:surface'];

    /**
     * @return array<string, array{0: string}>
     */
    public static function templates(): array
    {
        $result = [];
        foreach (self::OCCASIONS as $key) {
            foreach (['landing', 'hero', 'bar'] as $kind) {
                $result["festival-{$key}-{$kind}"] = ["festival-{$key}-{$kind}"];
            }
        }

        return $result;
    }

    private function library(): BuilderTemplateLibrary
    {
        return app(BuilderTemplateLibrary::class);
    }

    private function resolver(bool $withCoupon = true): TemplateReferenceResolver
    {
        return new class($withCoupon) implements TemplateReferenceResolver
        {
            public function __construct(private readonly bool $withCoupon) {}

            private function uuid(string $seed): string
            {
                $h = md5($seed);

                return substr($h, 0, 8).'-'.substr($h, 8, 4).'-4'.substr($h, 13, 3).'-a'.substr($h, 17, 3).'-'.substr($h, 20, 12);
            }

            public function media(string $asset): string
            {
                throw new \LogicException("Festival templates use no photos ({$asset}).");
            }

            public function banner(array $attributes): string
            {
                throw new \LogicException('Festival templates use no banners.');
            }

            public function menu(string $ref): ?string
            {
                return $this->uuid('menu'.$ref);
            }

            public function product(string $source, int $index): ?string
            {
                return $this->uuid("product{$source}{$index}");
            }

            public function promotion(string $ref): ?string
            {
                return $this->withCoupon ? $this->uuid("promotion{$ref}") : null;
            }
        };
    }

    private function newId(): callable
    {
        $n = 0;

        return function (string $prefix) use (&$n): string {
            return $prefix.'_f'.(++$n);
        };
    }

    /**
     * The normalized sections of a template in a context.
     *
     * @return list<array<string, mixed>>
     */
    private function normalized(string $id, string $context, bool $withCoupon = true): array
    {
        $concrete = PortableTemplate::concrete($this->library()->content($id)['sections'], $this->resolver($withCoupon), $this->newId());
        try {
            return BuilderDocumentSchema::normalize(['schema_version' => 1, 'sections' => $concrete], $context)['sections'];
        } catch (InvalidBuilderDocument $e) {
            $this->fail("{$id} is invalid in {$context}: ".json_encode($e->errors, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        }
    }

    public function test_every_occasion_has_a_landing_page_a_hero_and_a_bar(): void
    {
        $festival = array_values(array_filter($this->library()->all(), fn (array $t) => $t['category'] === 'festival'));
        $this->assertSame(array_keys(self::templates()), array_column($festival, 'id'), 'Exactly the 30 festival templates, in occasion order.');

        foreach (self::OCCASIONS as $key) {
            $landing = $this->library()->find("festival-{$key}-landing");
            $hero = $this->library()->find("festival-{$key}-hero");
            $bar = $this->library()->find("festival-{$key}-bar");
            $this->assertSame(['page', 'section', 'popup'], [$landing['scope'], $hero['scope'], $bar['scope']], $key);
            foreach ([$landing, $hero, $bar] as $t) {
                $this->assertNull($t['preset'], $t['id']);
                $this->assertNull($t['thumbnail'], "{$t['id']}: drawn sketch placeholder");
                $this->assertNull($t['preview'], $t['id']);
            }
            $this->assertContains('page', $landing['allowed_in']);
            $this->assertContains('page', $hero['allowed_in'], "{$key}: the hero goes on the home page");
            $this->assertSame(['popup'], $bar['allowed_in']);
            // The coupon (offer block) is what a festival landing needs; ekushey has none.
            $this->assertSame(in_array($key, self::TRIBUTE, true) ? [] : ['promotions'], $landing['requires'], $key);
            $this->assertSame([], $hero['requires'], $key);
            $this->assertSame([], $bar['requires'], $key);

            $sections = $this->library()->content("festival-{$key}-landing")['sections'];
            $this->assertGreaterThanOrEqual(6, count($sections), $key);
            $this->assertLessThanOrEqual(8, count($sections), $key);
            $heroSections = $this->library()->content("festival-{$key}-hero")['sections'];
            $this->assertGreaterThanOrEqual(1, count($heroSections));
            $this->assertLessThanOrEqual(2, count($heroSections));
            // The landing page opens with the home hero.
            $this->assertSame($heroSections, array_slice($sections, 0, count($heroSections)), "{$key}: the landing starts with the hero");

            // The Bangladesh trust blocks, the Bangla date and drawn ornaments on every landing page.
            $types = PortableTemplate::elementTypes($sections);
            foreach (['ornament', 'bangla_date', 'trust_badges', 'delivery_promise', 'payment_badges', 'product_grid', 'accordion'] as $type) {
                $this->assertContains($type, $types, "{$key} landing: {$type}");
            }
            $this->assertContains('ornament', PortableTemplate::elementTypes($heroSections), "{$key} hero");
            $this->assertContains('ornament', PortableTemplate::elementTypes($this->library()->content("festival-{$key}-bar")['sections']), "{$key} bar");
        }
    }

    /**
     * Countdowns run to the occasion's (expected) end — a placeholder the festival setup
     * overwrites — and the bar is on only for those dates.
     */
    public function test_the_dates_of_the_countdowns_and_the_bar(): void
    {
        foreach (self::OCCASIONS as $key) {
            $popup = $this->library()->popupSettings("festival-{$key}-bar");
            $this->assertSame('bar_top', $popup['layout'], $key);
            $this->assertSame('on_load', $popup['trigger']['kind'], $key);
            $this->assertNotNull($popup['starts_at'], $key);
            $this->assertNotNull($popup['ends_at'], $key);
            $starts = new \DateTimeImmutable($popup['starts_at']);
            $ends = new \DateTimeImmutable($popup['ends_at']);
            $this->assertGreaterThan($starts, $ends, $key);
            $this->assertLessThanOrEqual(60, $starts->diff($ends)->days, "{$key}: within the setup's 60-day limit");
            $this->assertSame('+06:00', $ends->format('P'), "{$key}: Bangladesh time");
            $this->assertNotEmpty($popup['translations']['bn']['label'] ?? null, $key);

            foreach (['landing', 'hero'] as $kind) {
                $json = json_encode($this->library()->content("festival-{$key}-{$kind}"));
                preg_match_all('/"type":"countdown","props":\{"source":"([a-z]+)","ends_at":"([^"]+)"/', $json, $m);
                $this->assertSame(array_fill(0, count($m[0]), 'date'), $m[1], "{$key} {$kind}: dated countdowns");
                $this->assertSame(array_fill(0, count($m[0]), $popup['ends_at']), $m[2], "{$key} {$kind}: countdown ends with the occasion");
                if ($kind === 'hero' && ! in_array($key, [...self::TRIBUTE, ...self::MODEST], true)) {
                    $this->assertCount(1, $m[0], "{$key}: the sale hero counts down to the end");
                }
            }
        }
    }

    #[DataProvider('templates')]
    public function test_the_template_validates_and_keeps_its_styles_in_every_context(string $id): void
    {
        $meta = $this->library()->find($id);
        $portable = $this->library()->content($id)['sections'];
        $this->assertSame([], PortableTemplate::assets($portable), "{$id}: no photos");
        $this->assertSame([], PortableTemplate::banners($portable), "{$id}: no banners");
        $this->assertStringNotContainsString('"media_id"', (string) json_encode($portable), $id);

        foreach ($meta['allowed_in'] as $context) {
            foreach ([true, false] as $withCoupon) {
                $sections = $this->normalized($id, $context, $withCoupon);
                $this->assertNotEmpty($sections, "{$id} in {$context}");
                if ($withCoupon) {
                    $this->assertCount(count($portable), $sections, $id);
                    // Nothing the template sets is dropped by the style normalizer.
                    $styles = fn (array $nodes) => $this->styles($nodes);
                    $this->assertEquals($styles($portable), $styles($sections), "{$id}: every style is valid as written");
                }
            }
        }

        // Offered wherever a festival template is meant to go.
        $contexts = ['landing' => ['page', 'cms'], 'hero' => ['page', 'cms', 'zone'], 'bar' => ['popup']][substr($id, strrpos($id, '-') + 1)];
        $this->assertSame($contexts, $meta['allowed_in'], $id);
    }

    #[DataProvider('templates')]
    public function test_every_text_has_bangla(string $id): void
    {
        $meta = $this->library()->find($id);
        $sections = $this->normalized($id, $meta['allowed_in'][0]);
        $count = 0;
        $this->visit($sections, function (array $node, string $kind) use ($id, &$count) {
            if ($kind !== 'element') {
                return;
            }
            $type = $node['type'];
            foreach (ElementRegistry::translationFields($type, $node['props']) as $field => $max) {
                $path = ElementRegistry::translationTarget($type, $field, $node['props']);
                $base = $path === null ? null : data_get($node['props'], implode('.', $path));
                if (! is_string($base) || trim(strip_tags($base)) === '') {
                    continue;
                }
                $bn = $node['translations']['bn'][$field] ?? null;
                $this->assertIsString($bn, "{$id}: {$type} {$field} has Bangla");
                $plain = trim(strip_tags($bn));
                $this->assertMatchesRegularExpression('/\p{Bengali}/u', $plain, "{$id}: {$type} {$field} is written in Bangla");
                $this->assertDoesNotMatchRegularExpression('/[0-9]/', $plain, "{$id}: {$type} {$field} uses Bangla digits");
                $this->assertLessThanOrEqual($max, mb_strlen($bn), "{$id}: {$type} {$field}");
                $count++;
            }
        });
        $this->assertGreaterThan(0, $count, $id);

        if ($meta['scope'] === 'popup') {
            $this->assertMatchesRegularExpression('/\p{Bengali}/u', $this->library()->popupSettings($id)['translations']['bn']['label']);
        }
    }

    /**
     * Ekushey is a tribute (no sale wording, no offer, no countdown); the national days are
     * dignified with at most a modest offer; the sale occasions count down and show offers.
     */
    public function test_respectful_days_carry_no_sale_wording(): void
    {
        foreach (self::OCCASIONS as $key) {
            $texts = [];
            $types = [];
            foreach (['landing', 'hero', 'bar'] as $kind) {
                $id = "festival-{$key}-{$kind}";
                $sections = $this->normalized($id, $this->library()->find($id)['allowed_in'][0]);
                $types = [...$types, ...PortableTemplate::elementTypes($sections)];
                $texts = [...$texts, ...$this->texts($sections)];
            }
            $copy = implode("\n", $texts);

            if (in_array($key, self::TRIBUTE, true)) {
                $this->assertDoesNotMatchRegularExpression('/\b(sale|sales|discount|offers?|deals?|prices?|cheap|mega|save)\b|% off|সেল|ছাড়|অফার|ডিল|দামে|মেগা/iu', $copy, "{$key}: no sale wording");
                foreach (['discount', 'countdown', 'flash_sale_bar', 'hot_deals', 'promo_card'] as $type) {
                    $this->assertNotContains($type, $types, "{$key}: {$type}");
                }
                $this->assertStringContainsString('ভাষা শহীদ', $copy);
                $this->assertStringContainsString('মাতৃভাষা', $copy);
            } elseif (in_array($key, self::MODEST, true)) {
                $this->assertDoesNotMatchRegularExpression('/\b(sale|mega|deals?|cheap|hurry)\b|সেল|মেগা|ডিল/iu', $copy, "{$key}: dignified wording");
                $this->assertContains('discount', $types, "{$key}: a modest thank-you offer");
                $this->assertStringContainsString('মুক্তিযোদ্ধা', $copy);
                $this->assertStringContainsString('শহীদ', $copy);
            } else {
                foreach (['discount', 'countdown', 'button'] as $type) {
                    $this->assertContains($type, $types, "{$key}: {$type}");
                }
            }
        }
    }

    /**
     * WCAG 2.2 AA for every text colour / background pair a template sets, under every theme
     * preset (theme roles resolve per preset; pairs left entirely to the theme are covered by
     * the theme preset tests).
     */
    #[DataProvider('templates')]
    public function test_text_colours_meet_wcag_aa(string $id): void
    {
        $meta = $this->library()->find($id);
        $sections = $this->normalized($id, $meta['allowed_in'][0]);
        $presets = array_map(fn (string $key) => ThemePresets::theme($key)['colors'], array_combine(ThemePresets::KEYS, ThemePresets::KEYS));
        $checked = 0;

        $check = function (string $fg, array $grounds, float $minimum, string $label) use ($presets, $id, &$checked) {
            foreach ($presets as $preset => $colors) {
                foreach ($grounds as $ground) {
                    [$f, $b] = [$this->resolve($fg, $colors), $this->resolve($ground, $colors)];
                    $this->assertGreaterThanOrEqual($minimum, self::contrast($f, $b), "{$id} {$label}: {$fg} ({$f}) on {$ground} ({$b}), preset {$preset}");
                    $checked++;
                }
            }
        };

        $walk = function (array $nodes, string $kind, ?array $grounds, ?string $color) use (&$walk, $check, $id) {
            foreach ($nodes as $node) {
                $style = $node['style'] ?? [];
                foreach (['tablet', 'mobile'] as $device) {
                    $this->assertArrayNotHasKey('background', $style[$device] ?? [], "{$id}: one ground on every device");
                    $this->assertArrayNotHasKey('color', $style[$device] ?? [], "{$id}: one text colour on every device");
                }
                $background = $style['base']['background'] ?? null;
                $nodeGrounds = $grounds;
                if (is_array($background)) {
                    $nodeGrounds = match ($background['type']) {
                        'color' => [$background['color']],
                        'gradient' => array_column($background['gradient']['stops'], 'color'),
                        'none' => $grounds,
                        default => $this->fail("{$id}: background {$background['type']} (no photos)"),
                    };
                }
                $nodeColor = $style['base']['color'] ?? $color;

                if ($kind === 'element') {
                    $type = $node['type'];
                    $set = $nodeGrounds !== null || $nodeColor !== null;
                    $ground = $nodeGrounds ?? ['theme:canvas'];
                    if ($set && ! in_array($type, self::ON_COLOUR, true)) {
                        // Blocks drawing with theme colours sit on the store's own ground only.
                        $this->assertSame([], array_diff($ground, self::THEME_GROUNDS), "{$id}: {$type} on a set colour");
                        $this->assertContains($nodeColor, [null, 'theme:text', 'theme:heading'], "{$id}: {$type} under a set text colour");
                    }
                    if ($set && in_array($type, self::INHERITING, true)) {
                        $fg = $nodeColor ?? ($type === 'heading' ? 'theme:heading' : 'theme:text');
                        $large = $type === 'heading' && $node['props']['level'] <= 3;
                        $check($fg, $ground, $large ? 3.0 : 4.5, "{$type} {$node['id']}");
                        if ($type === 'text') {
                            $this->assertStringNotContainsString('<a ', $node['props']['html'], "{$id}: links take the theme link colour, not the set one");
                        }
                    }
                    if ($set && $type === 'countdown') {
                        // Title in the heading colour, the "ends in" line in the sale colour, the expired text inherits.
                        $check('theme:heading', $ground, 3.0, "countdown title {$node['id']}");
                        $check('theme:sale', $ground, 4.5, "countdown label {$node['id']}");
                        $check($nodeColor ?? 'theme:text', $ground, 4.5, "countdown text {$node['id']}");
                    }
                    if ($set && $type === 'discount') {
                        // Its own surface card; the title and text inherit the colour.
                        $check($nodeColor ?? 'theme:text', ['theme:surface'], 4.5, "discount {$node['id']}");
                    }
                    if ($set && $type === 'button') {
                        $this->assertContains($node['props']['variant'], ['primary', 'accent'], "{$id}: a filled button on a set colour");
                    }
                    if ($type === 'ornament') {
                        $this->assertMatchesRegularExpression('/^(#[0-9a-f]{6}|theme:[a-z_]+)$/', $node['props']['color']);
                    }
                    if (isset($node['columns'])) {
                        $walk($node['columns'], 'column', $nodeGrounds, $nodeColor);
                    }
                } elseif ($kind === 'section') {
                    $walk($node['columns'], 'column', $nodeGrounds, $nodeColor);
                } else {
                    $walk($node['elements'], 'element', $nodeGrounds, $nodeColor);
                }
            }
        };
        $walk($sections, 'section', null, null);

        $this->assertGreaterThan(0, $checked, "{$id}: sets its own colours");
    }

    /**
     * Every style of every node, by position.
     *
     * @param  list<array<string, mixed>>  $sections
     * @return list<mixed>
     */
    private function styles(array $sections): array
    {
        $styles = [];
        $this->visit($sections, function (array $node) use (&$styles) {
            $styles[] = $node['style'] ?? [];
        });

        return $styles;
    }

    /**
     * Every base-language and Bangla text of the sections' elements.
     *
     * @param  list<array<string, mixed>>  $sections
     * @return list<string>
     */
    private function texts(array $sections): array
    {
        $texts = [];
        $this->visit($sections, function (array $node, string $kind) use (&$texts) {
            if ($kind !== 'element') {
                return;
            }
            foreach (array_keys(ElementRegistry::translationFields($node['type'], $node['props'])) as $field) {
                $path = ElementRegistry::translationTarget($node['type'], $field, $node['props']);
                $base = $path === null ? null : data_get($node['props'], implode('.', $path));
                if (is_string($base)) {
                    $texts[] = strip_tags($base);
                }
            }
            foreach ($node['translations']['bn'] ?? [] as $text) {
                $texts[] = strip_tags((string) $text);
            }
        });

        return $texts;
    }

    /**
     * @param  list<array<string, mixed>>  $sections
     * @param  callable(array<string, mixed>, string): void  $visit
     */
    private function visit(array $sections, callable $visit): void
    {
        $walk = function (array $nodes, string $kind) use (&$walk, $visit): void {
            foreach ($nodes as $node) {
                $visit($node, $kind);
                if ($kind === 'section') {
                    $walk($node['columns'] ?? [], 'column');
                } elseif ($kind === 'column') {
                    $walk($node['elements'] ?? [], 'element');
                } elseif (isset($node['columns'])) {
                    $walk($node['columns'], 'column');
                }
            }
        };
        $walk($sections, 'section');
    }

    /**
     * A `#rrggbb` colour, or a theme role resolved in a preset's colours.
     *
     * @param  array<string, string|null>  $colors
     */
    private function resolve(string $color, array $colors): string
    {
        if (str_starts_with($color, 'theme:')) {
            $hex = $colors[substr($color, 6)] ?? null;
            $this->assertIsString($hex, $color);

            return $hex;
        }
        $this->assertMatchesRegularExpression('/^#[0-9a-f]{6}$/', $color, 'Opaque colours only (contrast is checked as written).');

        return $color;
    }

    /**
     * WCAG 2 contrast ratio of two #rrggbb colours (as in ThemePresetsTest).
     */
    private static function contrast(string $a, string $b): float
    {
        $luminance = function (string $hex): float {
            $channels = array_map(function (int $i) use ($hex): float {
                $v = hexdec(substr($hex, 1 + 2 * $i, 2)) / 255;

                return $v <= 0.03928 ? $v / 12.92 : (($v + 0.055) / 1.055) ** 2.4;
            }, [0, 1, 2]);

            return 0.2126 * $channels[0] + 0.7152 * $channels[1] + 0.0722 * $channels[2];
        };
        [$x, $y] = [$luminance($a), $luminance($b)];

        return (max($x, $y) + 0.05) / (min($x, $y) + 0.05);
    }
}
