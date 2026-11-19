<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Shared\Domain\CampaignAttribution;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * B13: who sees a section or an element — `audience: {match: all|any, otherwise: hide, rules}`
 * on sections, global section references and elements (not columns). Audiences are
 * presentation, not security: every variant is in the (cacheable) public payload and the
 * storefront evaluates the rules in the browser.
 *
 * Rules (discriminator `kind`; the canonical form always has every key of its kind):
 * - `visitor` {is: new | returning}
 * - `account` {is: signed_in | guest}
 * - `device` {in: [desktop | tablet | mobile]} (unique, in that order)
 * - `district` {in: [geo district ids (int)]} (1–64, unique, ascending; existence checked by
 *   BuilderReferences)
 * - `campaign` {in: [campaign uuids], utm_source: [..], utm_campaign: [..]} (≤ 10 each, at least
 *   one value; utm values trimmed and lower-cased like P2a; campaigns checked by BuilderReferences)
 * - `cart` {min: "1500.00" | null, max: … | null} (NUMERIC strings, 2 decimals, at least one, min ≤ max)
 * - `time` {days: [mon … sun] (week order; [] every day), from: "HH:MM" | null, to: … | null}
 *   (from and to both or neither, not equal; to < from wraps past midnight; days or hours needed)
 * - `language` {in: [en | bn]}
 *
 * normalize() is pure; malformed values are errors (AUDIENCE_INVALID) with their path.
 */
final class AudienceRules
{
    public const ERROR_CODE = 'AUDIENCE_INVALID';

    public const MAX_RULES = 6;

    public const MATCHES = ['all', 'any'];

    public const OTHERWISE = ['hide'];

    public const KINDS = ['visitor', 'account', 'device', 'district', 'campaign', 'cart', 'time', 'language'];

    public const VISITORS = ['new', 'returning'];

    public const ACCOUNTS = ['signed_in', 'guest'];

    public const DEVICES = ['desktop', 'tablet', 'mobile'];

    public const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

    public const LANGUAGES = ['en', 'bn'];

    public const MAX_DISTRICTS = 64;

    public const MAX_CAMPAIGNS = 10;

    public const MAX_UTM_VALUES = 10;

    public const UTM_MAX = 100;

    public const CART_MAX = '99999999.99';

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    /** @var callable(string, string): void */
    private $error;

    /**
     * @param  callable(string, string): void  $error  (path, message)
     */
    private function __construct(callable $error)
    {
        $this->error = $error;
    }

    /**
     * The canonical audience, or null for everyone.
     *
     * @param  callable(string, string): void  $error  (path relative to the node, message)
     * @return array{match: string, otherwise: string, rules: list<array<string, mixed>>}|null
     */
    public static function normalize(mixed $value, callable $error): ?array
    {
        return $value === null ? null : (new self($error))->audience($value);
    }

    /**
     * The district ids and campaign ids a (normalized) audience refers to.
     *
     * @param  array<string, mixed>|null  $audience
     * @return array{districts: list<array{rule: int, ids: list<int>}>, campaigns: list<array{rule: int, ids: list<string>}>}
     */
    public static function references(?array $audience): array
    {
        $result = ['districts' => [], 'campaigns' => []];
        foreach ($audience['rules'] ?? [] as $i => $rule) {
            if (($rule['kind'] ?? null) === 'district' && ($rule['in'] ?? []) !== []) {
                $result['districts'][] = ['rule' => $i, 'ids' => $rule['in']];
            } elseif (($rule['kind'] ?? null) === 'campaign' && ($rule['in'] ?? []) !== []) {
                $result['campaigns'][] = ['rule' => $i, 'ids' => $rule['in']];
            }
        }

        return $result;
    }

    /**
     * @return array{match: string, otherwise: string, rules: list<array<string, mixed>>}|null
     */
    private function audience(mixed $value): ?array
    {
        if (! is_array($value) || ($value !== [] && array_is_list($value))) {
            $this->fail('audience', 'Who sees this is null (everyone) or {match, rules}.');

            return null;
        }
        $match = $value['match'] ?? 'all';
        if (! in_array($match, self::MATCHES, true)) {
            $this->fail('audience.match', 'Choose all or any.');
            $match = 'all';
        }
        $otherwise = $value['otherwise'] ?? 'hide';
        if (! in_array($otherwise, self::OTHERWISE, true)) {
            $this->fail('audience.otherwise', 'Shoppers the rules leave out see nothing here ("hide").');
            $otherwise = 'hide';
        }
        $raw = $value['rules'] ?? null;
        if (! is_array($raw) || ! array_is_list($raw) || $raw === [] || count($raw) > self::MAX_RULES) {
            $this->fail('audience.rules', 'Add 1 to '.self::MAX_RULES.' rules.');

            return null;
        }
        $rules = [];
        foreach ($raw as $i => $rule) {
            $normalized = $this->rule($rule, "audience.rules.{$i}");
            if ($normalized !== null) {
                $rules[] = $normalized;
            }
        }

        return ['match' => $match, 'otherwise' => $otherwise, 'rules' => $rules];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function rule(mixed $rule, string $path): ?array
    {
        if (! is_array($rule) || ! in_array($rule['kind'] ?? null, self::KINDS, true)) {
            $this->fail("{$path}.kind", 'Choose one of: '.implode(', ', self::KINDS).'.');

            return null;
        }

        return match ($rule['kind']) {
            'visitor' => $this->is($rule, $path, self::VISITORS),
            'account' => $this->is($rule, $path, self::ACCOUNTS),
            'device' => $this->choices($rule, $path, self::DEVICES),
            'language' => $this->choices($rule, $path, self::LANGUAGES),
            'district' => $this->districts($rule, $path),
            'campaign' => $this->campaign($rule, $path),
            'cart' => $this->cart($rule, $path),
            'time' => $this->time($rule, $path),
        };
    }

    /**
     * @param  array<string, mixed>  $rule
     * @param  list<string>  $allowed
     * @return array{kind: string, is: string}|null
     */
    private function is(array $rule, string $path, array $allowed): ?array
    {
        if (! in_array($rule['is'] ?? null, $allowed, true)) {
            $this->fail("{$path}.is", 'Choose one of: '.implode(', ', $allowed).'.');

            return null;
        }

        return ['kind' => $rule['kind'], 'is' => $rule['is']];
    }

    /**
     * @param  array<string, mixed>  $rule
     * @param  list<string>  $allowed
     * @return array{kind: string, in: list<string>}|null
     */
    private function choices(array $rule, string $path, array $allowed): ?array
    {
        $in = $rule['in'] ?? null;
        if (! is_array($in) || ! array_is_list($in) || $in === [] || array_diff($in, $allowed) !== [] || count(array_filter($in, 'is_string')) !== count($in)) {
            $this->fail("{$path}.in", 'Choose one or more of: '.implode(', ', $allowed).'.');

            return null;
        }

        return ['kind' => $rule['kind'], 'in' => array_values(array_intersect($allowed, $in))];
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array{kind: string, in: list<int>}|null
     */
    private function districts(array $rule, string $path): ?array
    {
        $in = $rule['in'] ?? null;
        if (! is_array($in) || ! array_is_list($in) || $in === [] || count($in) > self::MAX_DISTRICTS) {
            $this->fail("{$path}.in", 'Choose 1 to '.self::MAX_DISTRICTS.' districts.');

            return null;
        }
        $ids = [];
        foreach ($in as $id) {
            if (! is_int($id) || $id < 1 || $id > 32767) {
                $this->fail("{$path}.in", 'Districts are chosen by their ids (whole numbers).');

                return null;
            }
            $ids[$id] = $id;
        }
        if (count($ids) !== count($in)) {
            $this->fail("{$path}.in", 'A district is chosen twice.');

            return null;
        }
        sort($ids);

        return ['kind' => 'district', 'in' => array_values($ids)];
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array{kind: string, in: list<string>, utm_source: list<string>, utm_campaign: list<string>}|null
     */
    private function campaign(array $rule, string $path): ?array
    {
        $valid = true;
        $in = $rule['in'] ?? [];
        $ids = [];
        if (! is_array($in) || ! array_is_list($in) || count($in) > self::MAX_CAMPAIGNS) {
            $this->fail("{$path}.in", 'Choose at most '.self::MAX_CAMPAIGNS.' campaigns.');
            $valid = false;
        } else {
            foreach ($in as $id) {
                $id = is_string($id) ? strtolower($id) : null;
                if ($id === null || preg_match(self::UUID, $id) !== 1) {
                    $this->fail("{$path}.in", 'Choose campaigns from the list.');
                    $valid = false;
                    break;
                }
                $ids[$id] = $id;
            }
        }
        $utm = [];
        foreach (['utm_source', 'utm_campaign'] as $key) {
            $utm[$key] = [];
            $values = $rule[$key] ?? [];
            if (! is_array($values) || ! array_is_list($values) || count($values) > self::MAX_UTM_VALUES) {
                $this->fail("{$path}.{$key}", 'Enter at most '.self::MAX_UTM_VALUES.' values.');
                $valid = false;

                continue;
            }
            foreach ($values as $v) {
                $clean = is_string($v) ? CampaignAttribution::utm($v) : null;
                if ($clean === null || mb_strlen(trim($v)) > self::UTM_MAX) {
                    $this->fail("{$path}.{$key}", 'Each value is 1 to '.self::UTM_MAX.' characters.');
                    $valid = false;
                    break;
                }
                $clean = mb_strtolower($clean);
                $utm[$key][$clean] = $clean;
            }
        }
        if (! $valid) {
            return null;
        }
        if ($ids === [] && $utm['utm_source'] === [] && $utm['utm_campaign'] === []) {
            $this->fail("{$path}.in", 'Choose a campaign or enter a source or campaign name.');

            return null;
        }

        return [
            'kind' => 'campaign',
            'in' => array_values($ids),
            'utm_source' => array_values($utm['utm_source']),
            'utm_campaign' => array_values($utm['utm_campaign']),
        ];
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array{kind: string, min: ?string, max: ?string}|null
     */
    private function cart(array $rule, string $path): ?array
    {
        $bounds = [];
        $valid = true;
        foreach (['min', 'max'] as $key) {
            $value = $rule[$key] ?? null;
            if ($value === null || $value === '') {
                $bounds[$key] = null;

                continue;
            }
            $amount = self::money($value);
            if ($amount === null) {
                $this->fail("{$path}.{$key}", 'Enter an amount from 0 to '.self::CART_MAX.' (at most 2 decimals).');
                $valid = false;

                continue;
            }
            $bounds[$key] = $amount;
        }
        if (! $valid) {
            return null;
        }
        if ($bounds['min'] === null && $bounds['max'] === null) {
            $this->fail("{$path}.min", 'Enter a lowest or a highest cart value.');

            return null;
        }
        if ($bounds['min'] !== null && $bounds['max'] !== null && Decimal::compare($bounds['min'], $bounds['max']) > 0) {
            $this->fail("{$path}.max", 'The highest cart value must not be below the lowest.');

            return null;
        }

        return ['kind' => 'cart', 'min' => $bounds['min'], 'max' => $bounds['max']];
    }

    /**
     * A money amount as a NUMERIC string with 2 decimals (never through a float), or null.
     */
    public static function money(mixed $value): ?string
    {
        if (is_int($value)) {
            $value = (string) $value;
        }
        if (! is_string($value) || preg_match('/^\d{1,8}(\.\d{1,2})?$/', trim($value)) !== 1) {
            return null;
        }
        $amount = Decimal::round(trim($value), 2);

        return Decimal::compare($amount, self::CART_MAX) > 0 ? null : $amount;
    }

    /**
     * @param  array<string, mixed>  $rule
     * @return array{kind: string, days: list<string>, from: ?string, to: ?string}|null
     */
    private function time(array $rule, string $path): ?array
    {
        $valid = true;
        $days = $rule['days'] ?? [];
        if (! is_array($days) || ! array_is_list($days) || count(array_filter($days, 'is_string')) !== count($days) || array_diff($days, self::DAYS) !== [] || count(array_unique($days)) !== count($days)) {
            $this->fail("{$path}.days", 'Choose days from: '.implode(', ', self::DAYS).'.');
            $valid = false;
            $days = [];
        }
        $hours = [];
        foreach (['from', 'to'] as $key) {
            $value = $rule[$key] ?? null;
            if ($value !== null && (! is_string($value) || preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $value) !== 1)) {
                $this->fail("{$path}.{$key}", 'Enter a time as HH:MM (00:00 to 23:59).');
                $valid = false;
                $value = null;
            }
            $hours[$key] = $value;
        }
        if (! $valid) {
            return null;
        }
        if (($hours['from'] === null) !== ($hours['to'] === null)) {
            $this->fail($hours['from'] === null ? "{$path}.from" : "{$path}.to", 'Enter both the start and the end time.');

            return null;
        }
        if ($hours['from'] !== null && $hours['from'] === $hours['to']) {
            $this->fail("{$path}.to", 'The end time must differ from the start time.');

            return null;
        }
        if ($days === [] && $hours['from'] === null) {
            $this->fail("{$path}.days", 'Choose days or hours.');

            return null;
        }

        return ['kind' => 'time', 'days' => array_values(array_intersect(self::DAYS, $days)), 'from' => $hours['from'], 'to' => $hours['to']];
    }

    private function fail(string $path, string $message): void
    {
        ($this->error)($path, $message);
    }
}
