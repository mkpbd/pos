<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Storefront\Domain\LinkTarget;
use Closure;

/**
 * Props of the B8a elements (selling blocks, trust & people, progress bars) for
 * BuilderDocumentSchema, like B6ElementProps: every key present afterwards (missing keys take
 * the registry defaults), unknown keys dropped, each value checked against its limit.
 *
 * - Buttons are flat `{label, url}` (not the B4 `{label, link: {url}}`).
 * - Prices are NUMERIC strings (ElementRegistry::MONEY_PATTERN: ≥ 0, at most 2 decimals),
 *   stored as given — never floats.
 * - Comparison cells are a map keyed by column id, written in column order; a missing cell is
 *   `{kind: no, text: ''}` and cells of unknown columns are dropped.
 * - Store hours: exactly seven days stored Monday → Sunday; `close` before `open` closes after
 *   midnight and `open` = `close` means open 24 hours.
 *
 * Ownership of referenced ids (media, products, promotions) is checked by
 * Application\Builder\BuilderReferences.
 */
final class B8ElementProps extends ElementProps
{
    private const IMAGE = 'Choose an image from the media library.';

    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $limit = fn (string $key) => ElementRegistry::LIST_LIMITS["{$type}.{$key}"];
        $max = fn (string $key) => ElementRegistry::B8A_TEXT_LIMITS["{$type}.{$key}"] ?? ElementRegistry::TRANSLATABLE[$type][$key];

        return match ($type) {
            'pricing_table' => ['plans' => $this->list('plans', $limit('plans'), fn (array $plan, string $path) => $this->plan($plan, $path, $max, $limit('plans.features')))],
            'before_after' => [
                'before' => $this->photo($this->raw('before'), 'before', $max('before.alt')),
                'after' => $this->photo($this->raw('after'), 'after', $max('after.alt')),
                'before_label' => $this->text($this->raw('before_label'), 'before_label', 0, $max('before_label')),
                'after_label' => $this->text($this->raw('after_label'), 'after_label', 0, $max('after_label')),
                'start' => $this->int('start', ElementRegistry::BEFORE_AFTER_START),
                'orientation' => $this->enum('orientation', ElementRegistry::BEFORE_AFTER_ORIENTATIONS),
                'aspect' => $this->enum('aspect', ElementRegistry::BEFORE_AFTER_ASPECTS),
            ],
            'comparison_table' => $this->comparison($max, $limit),
            'flash_sale_bar' => [
                'promotion_id' => $this->nullableUuid($this->raw('promotion_id'), 'promotion_id', 'Choose a flash sale (a promotion with a countdown), or none for the one ending first.'),
                'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
                'text' => $this->text($this->raw('text'), 'text', 0, $max('text')),
                'show_products' => $this->bool('show_products'),
                'product_limit' => $this->int('product_limit', ElementRegistry::FLASH_SALE_PRODUCT_LIMIT),
                'style' => $this->enum('style', ElementRegistry::FLASH_SALE_STYLES),
                'button' => $this->button($this->raw('button'), 'button', $max('button.label')),
            ],
            'bundle' => $this->bundle($max, $limit('items')),
            'team' => [
                'members' => $this->list('members', $limit('members'), fn (array $member, string $path) => [
                    'media_id' => $this->nullableUuid($member['media_id'] ?? null, "{$path}.media_id", self::IMAGE),
                    'name' => $this->text($member['name'] ?? null, "{$path}.name", 1, $max('members.name')),
                    'role' => $this->text($member['role'] ?? null, "{$path}.role", 0, $max('members.role')),
                    'bio' => $this->text($member['bio'] ?? null, "{$path}.bio", 0, $max('members.bio')),
                    'links' => $this->listOf($member['links'] ?? [], "{$path}.links", $limit('members.links'), fn (array $link, string $linkPath) => $this->teamLink($link, $linkPath, $max('members.links.url'))),
                ]),
                'columns' => $this->columns(ElementRegistry::TEAM_COLUMNS),
                'style' => $this->enum('style', ElementRegistry::TEAM_STYLES),
            ],
            'review_wall' => $this->reviewWall($max),
            'photo_grid' => [
                'images' => $this->list('images', $limit('images'), fn (array $image, string $path) => [
                    'media_id' => $this->uuid($image['media_id'] ?? null, "{$path}.media_id", self::IMAGE),
                    'alt' => $this->text($image['alt'] ?? null, "{$path}.alt", 0, $max('images.alt')),
                    'link' => $this->link($image['link'] ?? null, "{$path}.link"),
                ]),
                'columns' => $this->columns(ElementRegistry::PHOTO_GRID_COLUMNS),
                'gap' => $this->enum('gap', ElementRegistry::PHOTO_GRID_GAPS),
                'profile' => $this->button($this->raw('profile'), 'profile', $max('profile.label')),
                'hover' => $this->enum('hover', ElementRegistry::PHOTO_GRID_HOVERS),
            ],
            'store_hours' => [
                'days' => $this->days(),
                'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
                'note' => $this->text($this->raw('note'), 'note', 0, $max('note')),
                'show_open_now' => $this->bool('show_open_now'),
                'highlight_today' => $this->bool('highlight_today'),
                'week_starts' => $this->enum('week_starts', ElementRegistry::WEEK_STARTS),
            ],
            'progress_bars' => [
                'items' => $this->list('items', $limit('items'), fn (array $item, string $path) => [
                    'label' => $this->text($item['label'] ?? null, "{$path}.label", 1, $max('items.label')),
                    'value' => $this->decimal($item['value'] ?? null, "{$path}.value", [0, 100], 1),
                ]),
                'style' => $this->enum('style', ElementRegistry::PROGRESS_STYLES),
                'show_value' => $this->bool('show_value'),
                'animate' => $this->bool('animate'),
            ],
        };
    }

    /**
     * A pricing plan: a price (or a text such as "Free" when the price is null), its features
     * (each included or not) and an optional button.
     *
     * @param  array<string, mixed>  $plan
     * @param  Closure(string): int  $max
     * @param  array{0: int, 1: int}  $featureLimit
     * @return array<string, mixed>
     */
    private function plan(array $plan, string $path, Closure $max, array $featureLimit): array
    {
        $price = $this->money($plan['price'] ?? null, "{$path}.price");
        $priceText = $this->text($plan['price_text'] ?? null, "{$path}.price_text", 0, $max('plans.price_text'));
        if (($plan['price'] ?? null) === null && trim($priceText) === '') {
            $this->fail("{$path}.price_text", 'Enter a price, or a text such as "Free" or "Ask us".');
        }

        return [
            'name' => $this->text($plan['name'] ?? null, "{$path}.name", 1, $max('plans.name')),
            'price' => $price,
            'price_text' => $priceText,
            'period' => $this->text($plan['period'] ?? null, "{$path}.period", 0, $max('plans.period')),
            'description' => $this->text($plan['description'] ?? null, "{$path}.description", 0, $max('plans.description')),
            'features' => $this->listOf($plan['features'] ?? [], "{$path}.features", $featureLimit, fn (array $feature, string $featurePath) => [
                'text' => $this->text($feature['text'] ?? null, "{$featurePath}.text", 1, $max('plans.features.text')),
                'included' => $this->boolOf($feature['included'] ?? null, "{$featurePath}.included", true),
            ]),
            'button' => $this->button($plan['button'] ?? null, "{$path}.button", $max('plans.button.label')),
            'highlighted' => $this->boolOf($plan['highlighted'] ?? false, "{$path}.highlighted"),
            'badge' => $this->text($plan['badge'] ?? null, "{$path}.badge", 0, $max('plans.badge')),
        ];
    }

    /**
     * A price: null, or a NUMERIC string ≥ 0 with at most 2 decimals (stored as given).
     */
    private function money(mixed $value, string $path): ?string
    {
        if ($value === null) {
            return null;
        }
        if (is_string($value) && preg_match('/'.ElementRegistry::MONEY_PATTERN.'/', $value) === 1) {
            return $value;
        }
        $this->fail($path, 'Enter the price as a number such as 499 or 499.50 (at most 2 decimals), or leave it empty.');

        return null;
    }

    /**
     * `null` or a flat button `{label, url}`.
     *
     * @return array{label: string, url: string}|null
     */
    private function button(mixed $value, string $path, int $max): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            $this->fail($path, 'A button is empty or {label, url}.');

            return null;
        }
        $label = $this->text($value['label'] ?? null, "{$path}.label", 1, $max);
        $url = $value['url'] ?? null;
        if (! is_string($url) || ! LinkTarget::isSafe($url)) {
            $this->fail("{$path}.url", 'The link must be a site path such as /sale or an http(s) URL.');
            $url = '/';
        }

        return ['label' => $label, 'url' => $url];
    }

    /**
     * A before / after photo `{media_id, alt}`.
     *
     * @return array{media_id: ?string, alt: string}
     */
    private function photo(mixed $value, string $path, int $max): array
    {
        if (! is_array($value)) {
            $this->fail("{$path}.media_id", self::IMAGE);

            return ['media_id' => null, 'alt' => ''];
        }

        return [
            'media_id' => $this->uuid($value['media_id'] ?? null, "{$path}.media_id", self::IMAGE),
            'alt' => $this->text($value['alt'] ?? null, "{$path}.alt", 0, $max),
        ];
    }

    /**
     * A comparison table: 2–4 columns (a product each, optionally) × 1–20 rows with one cell
     * per column.
     *
     * @param  Closure(string): int  $max
     * @param  Closure(string): array{0: int, 1: int}  $limit
     * @return array<string, mixed>
     */
    private function comparison(Closure $max, Closure $limit): array
    {
        $products = [];
        $columns = $this->list('columns', $limit('columns'), function (array $column, string $path) use ($max, &$products) {
            $productId = $this->nullableUuid($column['product_id'] ?? null, "{$path}.product_id", 'Choose a product, or none.');
            if ($productId !== null && isset($products[$productId])) {
                $this->fail("{$path}.product_id", 'This product already has a column.');
            }
            if ($productId !== null) {
                $products[$productId] = true;
            }

            return [
                'title' => $this->text($column['title'] ?? null, "{$path}.title", 1, $max('columns.title')),
                'product_id' => $productId,
                'highlighted' => $this->boolOf($column['highlighted'] ?? false, "{$path}.highlighted"),
            ];
        });
        $columnIds = array_values(array_filter(array_column($columns, 'id'), fn (string $id) => $id !== ''));

        $rows = $this->list('rows', $limit('rows'), function (array $row, string $path) use ($max, $columnIds) {
            $raw = $row['cells'] ?? [];
            if (! is_array($raw) || ($raw !== [] && array_is_list($raw))) {
                $this->fail("{$path}.cells", 'The cells are {<column id>: {kind, text}}.');
                $raw = [];
            }
            $cells = [];
            foreach ($columnIds as $columnId) {
                $cell = $raw[$columnId] ?? null;
                if ($cell === null) {
                    $cells[$columnId] = ['kind' => 'no', 'text' => ''];

                    continue;
                }
                $cellPath = "{$path}.cells.{$columnId}";
                if (! is_array($cell)) {
                    $this->fail($cellPath, 'A cell is {kind: yes | no | text, text}.');
                    $cells[$columnId] = ['kind' => 'no', 'text' => ''];

                    continue;
                }
                $kind = $this->enumOf($cell['kind'] ?? null, "{$cellPath}.kind", ElementRegistry::COMPARISON_CELL_KINDS, 'no');
                $text = $this->text($cell['text'] ?? null, "{$cellPath}.text", $kind === 'text' ? 1 : 0, $max('rows.cells.text'));
                $cells[$columnId] = ['kind' => $kind, 'text' => $text];
            }

            return [
                'label' => $this->text($row['label'] ?? null, "{$path}.label", 1, $max('rows.label')),
                'cells' => $cells,
            ];
        });

        return [
            'columns' => $columns,
            'rows' => $rows,
            'show_prices' => $this->bool('show_prices'),
            'show_buttons' => $this->bool('show_buttons'),
        ];
    }

    /**
     * A bundle of 2–4 different products.
     *
     * @param  Closure(string): int  $max
     * @param  array{0: int, 1: int}  $limit
     * @return array<string, mixed>
     */
    private function bundle(Closure $max, array $limit): array
    {
        $products = [];
        $items = $this->list('items', $limit, function (array $item, string $path) use (&$products) {
            $productId = $this->uuid($item['product_id'] ?? null, "{$path}.product_id", 'Choose a product.');
            if ($productId !== null && isset($products[$productId])) {
                $this->fail("{$path}.product_id", 'This product is already in the bundle.');
            }
            if ($productId !== null) {
                $products[$productId] = true;
            }

            return ['product_id' => $productId];
        });

        return [
            'items' => $items,
            'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
            'text' => $this->text($this->raw('text'), 'text', 0, $max('text')),
            'button_label' => $this->text($this->raw('button_label'), 'button_label', 1, $max('button_label')),
        ];
    }

    /**
     * A team member's link: an e-mail address (`mailto:`), a website (http or https) or a
     * social profile (https only).
     *
     * @param  array<string, mixed>  $link
     * @return array{kind: string, url: string}
     */
    private function teamLink(array $link, string $path, int $max): array
    {
        $kind = $this->enumOf($link['kind'] ?? null, "{$path}.kind", ElementRegistry::TEAM_LINK_KINDS, 'website');
        $url = $link['url'] ?? null;
        $valid = is_string($url) && mb_strlen($url) <= $max && match ($kind) {
            'email' => preg_match('/^mailto:([^?#\s]+)$/i', $url, $m) === 1 && filter_var($m[1], FILTER_VALIDATE_EMAIL) !== false,
            'website' => LinkTarget::isSafe($url) && ! str_starts_with($url, '/'),
            default => LinkTarget::isSafe($url) && strtolower((string) parse_url($url, PHP_URL_SCHEME)) === 'https',
        };
        if (! $valid) {
            $this->fail("{$path}.url", match ($kind) {
                'email' => 'Enter an e-mail link such as mailto:hello@example.com.',
                'website' => 'Enter a web address starting with https:// or http://.',
                default => 'Enter the profile address starting with https://.',
            });
        }

        return ['kind' => $kind, 'url' => is_string($url) ? $url : ''];
    }

    /**
     * A review wall: the latest or best-rated approved reviews, or those of one product.
     *
     * @param  Closure(string): int  $max
     * @return array<string, mixed>
     */
    private function reviewWall(Closure $max): array
    {
        $source = $this->enum('source', ElementRegistry::REVIEW_SOURCES);
        $productId = $source === 'product'
            ? $this->uuid($this->raw('product_id'), 'product_id', 'Choose the product whose reviews to show.')
            : $this->nullableUuid($this->raw('product_id'), 'product_id', 'Choose a product, or none.');

        return [
            'source' => $source,
            'product_id' => $productId,
            'min_rating' => $this->int('min_rating', ElementRegistry::REVIEW_MIN_RATING),
            'limit' => $this->int('limit', ElementRegistry::REVIEW_LIMIT),
            'layout' => $this->enum('layout', ElementRegistry::REVIEW_LAYOUTS),
            'show_product' => $this->bool('show_product'),
            'show_summary' => $this->bool('show_summary'),
            'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
        ];
    }

    /**
     * Seven days, Monday to Sunday: `{day, closed, open, close}` with "HH:MM" times.
     *
     * @return list<array{day: string, closed: bool, open: string, close: string}>
     */
    private function days(): array
    {
        $raw = $this->raw('days');
        if (! is_array($raw) || ! array_is_list($raw) || count($raw) !== count(ElementRegistry::WEEKDAYS)) {
            $this->fail('days', 'List the seven days of the week, Monday to Sunday.');

            return $this->defaults['days'];
        }
        $result = [];
        foreach (ElementRegistry::WEEKDAYS as $i => $day) {
            $value = $raw[$i];
            $default = $this->defaults['days'][$i];
            if (! is_array($value)) {
                $this->fail("days.{$i}", 'Each day is {day, closed, open, close}.');
                $result[] = $default;

                continue;
            }
            if (($value['day'] ?? null) !== $day) {
                $this->fail("days.{$i}.day", "The days are listed Monday to Sunday; this one is \"{$day}\".");
            }
            $time = function (string $key) use ($value, $i, $default): string {
                $time = $value[$key] ?? null;
                if (is_string($time) && preg_match('/'.ElementRegistry::TIME_PATTERN.'/', $time) === 1) {
                    return $time;
                }
                $this->fail("days.{$i}.{$key}", 'Enter a time as HH:MM (24-hour clock), e.g. 09:30 or 21:00.');

                return $default[$key];
            };
            $result[] = [
                'day' => $day,
                'closed' => $this->boolOf($value['closed'] ?? false, "days.{$i}.closed"),
                'open' => $time('open'),
                'close' => $time('close'),
            ];
        }

        return $result;
    }
}
