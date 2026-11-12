<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Shared\Application\Localization\LocaleContext;
use Closure;
use DateTimeImmutable;
use stdClass;

/**
 * B8b: the `popup` settings of a popup document (`popup:<uuid>`, context `popup`): layout, size
 * and position, trigger, how often it shows, on which pages, devices and audience, priority and
 * schedule, and an optional accessible name (`label`, translatable). Every key is present after
 * normalize(); unknown keys are dropped; problems are reported through `$error(<path under
 * popup>, message, code?)` and the value falls back to its default. normalize() is pure and
 * idempotent.
 *
 * Popups never show on the checkout, cart, account or order pages: a `paths` entry under one of
 * NEVER_ON is refused (POPUP_PAGE_FORBIDDEN) and the storefront runtime skips those pages for
 * every popup (`never_on` in the public payload).
 */
final class PopupSettings
{
    public const LAYOUTS = ['modal', 'slide_in', 'bar_top', 'bar_bottom', 'fullscreen'];

    /** Layouts of which at most one shows at a time (bars may show one per edge besides). */
    public const OVERLAY_LAYOUTS = ['modal', 'slide_in', 'fullscreen'];

    public const POSITIONS = ['bottom_left', 'bottom_right'];

    public const WIDTHS = ['sm', 'md', 'lg'];

    public const TRIGGERS = ['on_load', 'on_scroll', 'on_exit'];

    public const FREQUENCIES = ['every_page_view', 'once_per_session', 'once_every_days', 'once_forever'];

    public const PAGES = ['all', 'home', 'shop', 'paths'];

    public const DEVICES = ['all', 'desktop', 'mobile'];

    public const AUDIENCES = ['all', 'guests', 'signed_in'];

    /** Path prefixes a popup never shows on (server-enforced). */
    public const NEVER_ON = ['/checkout', '/cart', '/account', '/order'];

    public const DELAY_SECONDS = [0, 120];

    public const SCROLL_PERCENT = [10, 90];

    public const DAYS = [1, 365];

    public const PRIORITY = [0, 100];

    public const MAX_PATHS = 20;

    public const PATH_PATTERN = '^/[a-z0-9][a-z0-9/_.~-]{0,119}$';

    public const LABEL_MAX = 120;

    private const INSTANT = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/';

    /**
     * @param  Closure(string, string, ?string): void  $error
     */
    private function __construct(private readonly Closure $error) {}

    /**
     * @return array<string, mixed>
     */
    public static function defaults(): array
    {
        return [
            'layout' => 'modal',
            'position' => 'bottom_right',
            'width' => 'md',
            'overlay' => true,
            'close_on_overlay' => true,
            'label' => '',
            'trigger' => ['kind' => 'on_load', 'delay_seconds' => 5, 'scroll_percent' => 50],
            'frequency' => ['kind' => 'once_per_session', 'days' => 7],
            'stop_after_action' => true,
            'pages' => ['kind' => 'all', 'paths' => []],
            'devices' => 'all',
            'audience' => 'all',
            'priority' => 50,
            'starts_at' => null,
            'ends_at' => null,
            'translations' => [],
        ];
    }

    /**
     * Limits for the editor (`GET /storefront/builder/elements` `limits.popup`).
     *
     * @return array<string, mixed>
     */
    public static function limits(): array
    {
        return [
            'delay_seconds' => ['min' => self::DELAY_SECONDS[0], 'max' => self::DELAY_SECONDS[1]],
            'scroll_percent' => ['min' => self::SCROLL_PERCENT[0], 'max' => self::SCROLL_PERCENT[1]],
            'days' => ['min' => self::DAYS[0], 'max' => self::DAYS[1]],
            'priority' => ['min' => self::PRIORITY[0], 'max' => self::PRIORITY[1]],
            'paths' => self::MAX_PATHS,
            'path_pattern' => self::PATH_PATTERN,
            'label' => self::LABEL_MAX,
        ];
    }

    /**
     * @param  Closure(string, string, ?string): void  $error  path under `popup`, message, code
     * @return array<string, mixed>
     */
    public static function normalize(mixed $value, Closure $error): array
    {
        return (new self($error))->settings($value);
    }

    /**
     * The settings as API output: empty `translations` as `{}`.
     *
     * @param  array<string, mixed>  $settings
     * @return array<string, mixed>
     */
    public static function present(array $settings): array
    {
        if (($settings['translations'] ?? null) === []) {
            $settings['translations'] = new stdClass;
        }

        return $settings;
    }

    /**
     * Whether a store path is one popups never show on.
     */
    public static function forbiddenPath(string $path): bool
    {
        $path = strtolower($path);
        foreach (self::NEVER_ON as $prefix) {
            if (str_starts_with($path, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, mixed>
     */
    private function settings(mixed $value): array
    {
        $defaults = self::defaults();
        if ($value === null) {
            return $defaults;
        }
        if (! is_array($value)) {
            $this->fail('', 'The popup settings must be an object.');

            return $defaults;
        }
        $raw = fn (string $key) => array_key_exists($key, $value) ? $value[$key] : $defaults[$key];
        $enum = function (string $key, array $allowed) use ($raw, $defaults) {
            if (in_array($raw($key), $allowed, true)) {
                return $raw($key);
            }
            $this->fail($key, 'Choose one of: '.implode(', ', $allowed).'.');

            return $defaults[$key];
        };
        $bool = function (string $key) use ($raw, $defaults) {
            if (is_bool($raw($key))) {
                return $raw($key);
            }
            $this->fail($key, 'This setting is true or false.');

            return $defaults[$key];
        };

        $label = $raw('label') ?? '';
        if (! is_string($label) || mb_strlen($label) > self::LABEL_MAX) {
            $this->fail('label', 'At most '.self::LABEL_MAX.' characters.');
            $label = '';
        }
        $priority = $raw('priority');
        if (! is_int($priority) || $priority < self::PRIORITY[0] || $priority > self::PRIORITY[1]) {
            $this->fail('priority', 'Enter a whole number from '.self::PRIORITY[0].' to '.self::PRIORITY[1].'.');
            $priority = $defaults['priority'];
        }
        [$startsAt, $endsAt] = $this->schedule($raw('starts_at'), $raw('ends_at'));

        return [
            'layout' => $enum('layout', self::LAYOUTS),
            'position' => $enum('position', self::POSITIONS),
            'width' => $enum('width', self::WIDTHS),
            'overlay' => $bool('overlay'),
            'close_on_overlay' => $bool('close_on_overlay'),
            'label' => $label,
            'trigger' => $this->trigger($raw('trigger'), $defaults['trigger']),
            'frequency' => $this->frequency($raw('frequency'), $defaults['frequency']),
            'stop_after_action' => $bool('stop_after_action'),
            'pages' => $this->pages($raw('pages'), $defaults['pages']),
            'devices' => $enum('devices', self::DEVICES),
            'audience' => $enum('audience', self::AUDIENCES),
            'priority' => $priority,
            'starts_at' => $startsAt,
            'ends_at' => $endsAt,
            'translations' => $this->translations($raw('translations')),
        ];
    }

    /**
     * @param  array<string, mixed>  $default
     * @return array{kind: string, delay_seconds: int, scroll_percent: int}
     */
    private function trigger(mixed $value, array $default): array
    {
        if (! is_array($value)) {
            $this->fail('trigger', 'The trigger is {kind, delay_seconds, scroll_percent}.');

            return $default;
        }
        $kind = $value['kind'] ?? $default['kind'];
        if (! in_array($kind, self::TRIGGERS, true)) {
            $this->fail('trigger.kind', 'Choose one of: '.implode(', ', self::TRIGGERS).'.');
            $kind = $default['kind'];
        }

        return [
            'kind' => $kind,
            'delay_seconds' => $this->int($value['delay_seconds'] ?? $default['delay_seconds'], 'trigger.delay_seconds', self::DELAY_SECONDS, $default['delay_seconds']),
            'scroll_percent' => $this->int($value['scroll_percent'] ?? $default['scroll_percent'], 'trigger.scroll_percent', self::SCROLL_PERCENT, $default['scroll_percent']),
        ];
    }

    /**
     * @param  array<string, mixed>  $default
     * @return array{kind: string, days: int}
     */
    private function frequency(mixed $value, array $default): array
    {
        if (! is_array($value)) {
            $this->fail('frequency', 'How often is {kind, days}.');

            return $default;
        }
        $kind = $value['kind'] ?? $default['kind'];
        if (! in_array($kind, self::FREQUENCIES, true)) {
            $this->fail('frequency.kind', 'Choose one of: '.implode(', ', self::FREQUENCIES).'.');
            $kind = $default['kind'];
        }

        return ['kind' => $kind, 'days' => $this->int($value['days'] ?? $default['days'], 'frequency.days', self::DAYS, $default['days'])];
    }

    /**
     * @param  array<string, mixed>  $default
     * @return array{kind: string, paths: list<string>}
     */
    private function pages(mixed $value, array $default): array
    {
        if (! is_array($value)) {
            $this->fail('pages', 'The pages are {kind, paths}.');

            return $default;
        }
        $kind = $value['kind'] ?? $default['kind'];
        if (! in_array($kind, self::PAGES, true)) {
            $this->fail('pages.kind', 'Choose one of: '.implode(', ', self::PAGES).'.');
            $kind = $default['kind'];
        }
        $raw = $value['paths'] ?? [];
        $paths = [];
        if (! is_array($raw) || ! array_is_list($raw)) {
            $this->fail('pages.paths', 'The paths must be a list.');
        } elseif (count($raw) > self::MAX_PATHS) {
            $this->fail('pages.paths', 'Add at most '.self::MAX_PATHS.' pages.');
        } else {
            foreach ($raw as $i => $path) {
                if (is_string($path) && self::forbiddenPath($path)) {
                    $this->fail("pages.paths.{$i}", 'Popups never show on the checkout, cart, account or order pages.', 'POPUP_PAGE_FORBIDDEN');

                    continue;
                }
                if (! is_string($path) || preg_match('#'.self::PATH_PATTERN.'#', $path) !== 1) {
                    $this->fail("pages.paths.{$i}", 'Enter a store address starting with "/", e.g. /p/eid-sale (lower-case letters, digits, "-", "_", "." and "/").');

                    continue;
                }
                if (in_array($path, $paths, true)) {
                    $this->fail("pages.paths.{$i}", 'This page is listed twice.');

                    continue;
                }
                $paths[] = $path;
            }
        }
        if ($kind === 'paths' && $paths === [] && is_array($raw) && $raw === []) {
            $this->fail('pages.paths', 'Add at least one page, or show the popup on all pages.');
        }

        return ['kind' => $kind, 'paths' => $paths];
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    private function schedule(mixed $startsAt, mixed $endsAt): array
    {
        $result = [];
        $instants = [];
        foreach (['starts_at' => $startsAt, 'ends_at' => $endsAt] as $key => $value) {
            if ($value === null) {
                $result[] = null;

                continue;
            }
            $parsed = is_string($value) && preg_match(self::INSTANT, $value) === 1 ? DateTimeImmutable::createFromFormat(DATE_ATOM, self::atom($value)) : false;
            if ($parsed === false) {
                $this->fail($key, 'Use an ISO 8601 date and time with a time zone, e.g. 2026-12-01T00:00:00+06:00.');
                $result[] = null;

                continue;
            }
            $result[] = $value;
            $instants[$key] = $parsed;
        }
        if (isset($instants['starts_at'], $instants['ends_at']) && $instants['ends_at'] <= $instants['starts_at']) {
            $this->fail('ends_at', 'The end of the schedule must be after its start.');
        }

        return [$result[0], $result[1]];
    }

    private static function atom(string $instant): string
    {
        preg_match('/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/', $instant, $m);
        $zone = $m[3] === 'Z' ? '+00:00' : (strlen($m[3]) === 5 ? substr($m[3], 0, 3).':'.substr($m[3], 3) : $m[3]);

        return $m[1].($m[2] !== '' ? $m[2] : ':00').$zone;
    }

    /**
     * `{<locale>: {label}}`; blank values and empty locales dropped.
     *
     * @return array<string, array<string, string>>
     */
    private function translations(mixed $value): array
    {
        if ($value === null) {
            return [];
        }
        if (! is_array($value)) {
            $this->fail('translations', 'The translations must be an object.');

            return [];
        }
        $result = [];
        foreach (LocaleContext::TRANSLATABLE as $locale) {
            $label = is_array($value[$locale] ?? null) ? ($value[$locale]['label'] ?? null) : null;
            if ($label === null || (is_string($label) && trim($label) === '')) {
                continue;
            }
            if (! is_string($label) || mb_strlen($label) > self::LABEL_MAX) {
                $this->fail("translations.{$locale}.label", 'The translation must be text of at most '.self::LABEL_MAX.' characters.');

                continue;
            }
            $result[$locale] = ['label' => $label];
        }

        return $result;
    }

    /**
     * @param  array{0: int, 1: int}  $range
     */
    private function int(mixed $value, string $path, array $range, int $fallback): int
    {
        if (is_int($value) && $value >= $range[0] && $value <= $range[1]) {
            return $value;
        }
        $this->fail($path, "Enter a whole number from {$range[0]} to {$range[1]}.");

        return $fallback;
    }

    private function fail(string $path, string $message, ?string $code = null): void
    {
        ($this->error)($path, $message, $code);
    }
}
