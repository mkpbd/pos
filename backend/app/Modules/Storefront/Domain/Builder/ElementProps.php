<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Storefront\Domain\LinkTarget;
use Closure;

/**
 * Shared checks of the builder elements' props normalizers (B6ElementProps, B8ElementProps):
 * every value is checked against its limit, problems are reported through
 * `$error(<prop path>, message)` and the value falls back to its default (or a neutral value).
 * Repeatable lists hold objects with an `id` (BuilderDocumentSchema::ID_PATTERN, unique within
 * the list) that translations refer to.
 */
abstract class ElementProps
{
    protected const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    /** @var array<string, mixed> */
    protected array $defaults = [];

    /** @var array<string, mixed> */
    protected array $props = [];

    /**
     * @param  Closure(string, string): void  $error  path relative to the props, message
     */
    public function __construct(protected readonly Closure $error) {}

    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    abstract public function normalize(string $type, array $props): array;

    /**
     * @param  array<string, mixed>  $props
     */
    protected function start(string $type, array $props): void
    {
        $this->defaults = ElementRegistry::defaults($type);
        $this->props = $props;
    }

    protected function fail(string $path, string $message): void
    {
        ($this->error)($path, $message);
    }

    /**
     * A list prop of objects with unique ids: each normalized by `$item(item, path)` and
     * prefixed with its id.
     *
     * @param  array{0: int, 1: int}  $limit
     * @param  Closure(array<string, mixed>, string): array<string, mixed>  $item
     * @return list<array<string, mixed>>
     */
    protected function list(string $key, array $limit, Closure $item): array
    {
        return $this->listOf($this->raw($key), $key, $limit, $item);
    }

    /**
     * A list value (at `$path`) of objects with unique ids.
     *
     * @param  array{0: int, 1: int}  $limit
     * @param  Closure(array<string, mixed>, string): array<string, mixed>  $item
     * @return list<array<string, mixed>>
     */
    protected function listOf(mixed $raw, string $path, array $limit, Closure $item): array
    {
        if (! is_array($raw) || ! array_is_list($raw)) {
            $this->fail($path, 'This must be a list.');

            return [];
        }
        [$min, $max] = $limit;
        if (count($raw) < $min || count($raw) > $max) {
            $this->fail($path, $min === $max ? "Add exactly {$min}." : "Add {$min} to {$max}.");
        }

        $result = [];
        $ids = [];
        foreach ($raw as $i => $value) {
            if (! is_array($value)) {
                $this->fail("{$path}.{$i}", 'Each entry must be an object.');

                continue;
            }
            $id = $value['id'] ?? null;
            if (! is_string($id) || preg_match('/'.BuilderDocumentSchema::ID_PATTERN.'/', $id) !== 1) {
                $this->fail("{$path}.{$i}.id", 'An id is 2–32 lower-case letters, digits, "_" or "-", starting with a letter.');
                $id = is_string($id) ? $id : '';
            } elseif (isset($ids[$id])) {
                $this->fail("{$path}.{$i}.id", "The id \"{$id}\" is used more than once in this list.");
            }
            $ids[$id] = true;
            $result[] = ['id' => $id, ...$item($value, "{$path}.{$i}")];
        }

        return $result;
    }

    protected function raw(string $key): mixed
    {
        return array_key_exists($key, $this->props) ? $this->props[$key] : $this->defaults[$key];
    }

    /**
     * Text of `$min`–`$max` characters (`$min` counts non-blank characters); null is '' when
     * the text is optional.
     */
    protected function text(mixed $value, string $path, int $min, int $max, ?string $message = null, string $fallback = ''): string
    {
        if ($value === null && $min === 0) {
            return '';
        }
        if (is_string($value) && mb_strlen(trim($value)) >= $min && mb_strlen($value) <= $max) {
            return $value;
        }
        $this->fail($path, $message ?? ($min > 0 ? "Enter {$min} to {$max} characters." : "At most {$max} characters."));

        return $fallback;
    }

    /**
     * Optional text where null means "use the default" (blank is null).
     */
    protected function nullableText(mixed $value, string $path, int $max): ?string
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return null;
        }
        if (is_string($value) && mb_strlen($value) <= $max) {
            return $value;
        }
        $this->fail($path, "At most {$max} characters.");

        return null;
    }

    /**
     * @param  list<string>  $allowed
     */
    protected function enum(string $key, array $allowed): string
    {
        $value = $this->raw($key);
        if (in_array($value, $allowed, true)) {
            return $value;
        }
        $this->fail($key, 'Choose one of: '.implode(', ', $allowed).'.');

        return $this->defaults[$key];
    }

    /**
     * @param  list<string>  $allowed
     */
    protected function enumOf(mixed $value, string $path, array $allowed, string $fallback): string
    {
        if (is_string($value) && in_array($value, $allowed, true)) {
            return $value;
        }
        $this->fail($path, 'Choose one of: '.implode(', ', $allowed).'.');

        return $fallback;
    }

    /**
     * @param  array{0: int, 1: int}  $range
     */
    protected function int(string $key, array $range): int
    {
        $value = $this->raw($key);
        if (is_int($value) && $value >= $range[0] && $value <= $range[1]) {
            return $value;
        }
        $this->fail($key, "Enter a whole number from {$range[0]} to {$range[1]}.");

        return $this->defaults[$key];
    }

    protected function bool(string $key): bool
    {
        $value = $this->raw($key);
        if (is_bool($value)) {
            return $value;
        }
        $this->fail($key, 'This setting is true or false.');

        return $this->defaults[$key];
    }

    protected function boolOf(mixed $value, string $path, bool $fallback = false): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        $this->fail($path, 'This setting is true or false.');

        return $fallback;
    }

    protected function icon(mixed $value, string $path, bool $nullable): ?string
    {
        if ($value === null && $nullable) {
            return null;
        }
        if (is_string($value) && in_array($value, ElementRegistry::ICONS, true)) {
            return $value;
        }
        $this->fail($path, 'Choose an icon of the store icon set.');

        return $nullable ? null : 'star';
    }

    /**
     * A number from `$range[0]` to `$range[1]` with at most `$decimals` decimals (whole numbers
     * stored as integers).
     *
     * @param  array{0: int|float, 1: int|float}  $range
     */
    protected function decimal(mixed $value, string $path, array $range, int $decimals): int|float
    {
        if ((is_int($value) || is_float($value)) && is_finite((float) $value) && $value >= $range[0] && $value <= $range[1]
            && abs(round((float) $value, $decimals) - (float) $value) < 1e-9) {
            $rounded = round((float) $value, $decimals);

            return $rounded === floor($rounded) ? (int) $rounded : $rounded;
        }
        $this->fail($path, "Enter a number from {$range[0]} to {$range[1]} with at most {$decimals} ".($decimals === 1 ? 'decimal.' : 'decimals.'));

        return $range[0];
    }

    /**
     * An organization record id (lower-cased), or null with an error.
     */
    protected function uuid(mixed $value, string $path, string $message): ?string
    {
        if (is_string($value) && preg_match(self::UUID, strtolower($value)) === 1) {
            return strtolower($value);
        }
        $this->fail($path, $message);

        return null;
    }

    /**
     * A record id or null (null is fine).
     */
    protected function nullableUuid(mixed $value, string $path, string $message): ?string
    {
        return $value === null ? null : $this->uuid($value, $path, $message);
    }

    /**
     * `null` or `{url}` with a safe link (site path or http(s) URL).
     *
     * @return array{url: string}|null
     */
    protected function link(mixed $value, string $path): ?array
    {
        if ($value === null) {
            return null;
        }
        $url = is_array($value) ? ($value['url'] ?? null) : null;
        if (! is_string($url) || ! LinkTarget::isSafe($url)) {
            $this->fail(is_array($value) ? "{$path}.url" : $path, 'The link must be a site path such as /sale or an http(s) URL.');

            return null;
        }

        return ['url' => $url];
    }

    /**
     * Responsive columns `{base, tablet?, mobile?}` (tablet and mobile left out when not set).
     *
     * @param  array<string, array{0: int, 1: int}>  $ranges  breakpoint => [min, max]
     * @return array<string, int>
     */
    protected function columns(array $ranges, string $key = 'columns'): array
    {
        $raw = $this->raw($key);
        if (! is_array($raw)) {
            $this->fail($key, 'The columns are {base, tablet, mobile}.');

            return $this->defaults[$key];
        }
        $result = [];
        foreach ($ranges as $breakpoint => [$min, $max]) {
            $value = $raw[$breakpoint] ?? null;
            if ($value === null && $breakpoint !== 'base') {
                continue;
            }
            if (! is_int($value) || $value < $min || $value > $max) {
                $this->fail("{$key}.{$breakpoint}", "Enter a whole number from {$min} to {$max}.");
                $value = $this->defaults[$key][$breakpoint] ?? $min;
            }
            $result[$breakpoint] = $value;
        }

        return $result;
    }
}
