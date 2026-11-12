<?php

namespace App\Modules\Storefront\Domain\Forms;

use App\Modules\Storefront\Domain\Builder\ElementRegistry;

/**
 * B8b: checks what a visitor sent with a builder `form` element against its (normalized,
 * published) fields and turns it into what is stored. Pure.
 *
 * Posted values, keyed by field id: text, e-mail, phone, textarea and date (YYYY-MM-DD) are
 * strings; number a number or numeric string (at most 2 decimals, inside min / max); select and
 * radio an option id; checkbox a boolean; checkboxes a list of option ids. Missing, null, "" or
 * [] is unanswered (an error when the field is required; a required checkbox must be ticked).
 * Keys that are not fields of the form are refused. A form with a consent text needs
 * `consent: true`.
 *
 * Stored values (`values`, in field order, every field present): trimmed strings, numbers as
 * decimal strings, a checkbox as true / false, choices as the chosen options' labels (base
 * language) and null for unanswered fields. `fields` is the snapshot `[{id, label, kind}]`.
 * `reply_to` is the answer of the reply-to e-mail field.
 */
final class FormAnswers
{
    public const PHONE_PATTERN = '/^\+?[0-9][0-9 ()\-]{5,19}$/';

    public const NUMBER_PATTERN = '/^-?\d{1,10}(\.\d{1,2})?$/';

    public const EMAIL_MAX = 254;

    /**
     * @param  array<string, mixed>  $props  the form element's normalized props (base language)
     * @return array{fields: list<array{id: string, label: string, kind: string}>, values: array<string, mixed>, reply_to: ?string, errors: array<string, string>}
     */
    public static function check(array $props, mixed $values, mixed $consent): array
    {
        $errors = [];
        $fields = [];
        $stored = [];
        $replyTo = null;

        if (! is_array($values) || ($values !== [] && array_is_list($values))) {
            $errors['values'] = 'The answers must be an object keyed by field id.';
            $values = [];
        }
        $known = [];
        foreach ($props['fields'] as $field) {
            $known[$field['id']] = true;
            $fields[] = ['id' => $field['id'], 'label' => $field['label'], 'kind' => $field['kind']];
            [$value, $error] = self::answer($field, $values[$field['id']] ?? null);
            if ($error !== null) {
                $errors['values.'.$field['id']] = $error;
            }
            $stored[$field['id']] = $value;
            if ($field['reply_to'] && $field['kind'] === 'email' && is_string($value)) {
                $replyTo = $value;
            }
        }
        foreach (array_keys($values) as $key) {
            if (! isset($known[$key])) {
                $errors['values.'.$key] = 'This field is not part of the form.';
            }
        }
        if ($props['consent'] !== null && $consent !== true) {
            $errors['consent'] = 'Please tick the box to agree before sending.';
        }

        return ['fields' => $fields, 'values' => $stored, 'reply_to' => $replyTo, 'errors' => $errors];
    }

    /**
     * A stored answer as text: lists joined with ", ", a checkbox as Yes / No, nothing as "—".
     */
    public static function text(mixed $value): string
    {
        return match (true) {
            $value === null || $value === '' || $value === [] => '—',
            is_bool($value) => $value ? 'Yes' : 'No',
            is_array($value) => implode(', ', array_map(fn ($v) => (string) $v, $value)),
            default => (string) $value,
        };
    }

    /**
     * "Label: answer · Label: answer" from the first answered fields (`$count`), each answer cut
     * to `$max` characters; "No answers" when nothing was answered.
     *
     * @param  list<array{id: string, label: string, kind: string}>  $fields
     * @param  array<string, mixed>  $values
     */
    public static function summary(array $fields, array $values, int $count = 2, int $max = 60): string
    {
        $parts = [];
        foreach ($fields as $field) {
            $value = $values[$field['id']] ?? null;
            if ($value === null || $value === '' || $value === [] || $value === false) {
                continue;
            }
            $text = preg_replace('/\s+/u', ' ', self::text($value)) ?? '';
            if (mb_strlen($text) > $max) {
                $text = mb_substr($text, 0, $max - 1).'…';
            }
            $parts[] = "{$field['label']}: {$text}";
            if (count($parts) >= $count) {
                break;
            }
        }

        return $parts === [] ? 'No answers' : implode(' · ', $parts);
    }

    /**
     * @param  array<string, mixed>  $field
     * @return array{0: mixed, 1: ?string} the stored value and an error
     */
    private static function answer(array $field, mixed $value): array
    {
        $kind = $field['kind'];
        if (is_string($value)) {
            $value = trim($value);
        }
        $empty = $value === null || $value === '' || $value === [] || ($kind === 'checkbox' && $value === false);
        if ($empty) {
            if ($field['required']) {
                return [$kind === 'checkbox' ? false : null, $kind === 'checkbox' ? 'Please tick this box.' : 'Please fill in this field.'];
            }

            return [$kind === 'checkbox' ? false : null, null];
        }

        return match ($kind) {
            'text', 'textarea' => self::textAnswer($field, $value),
            'email' => is_string($value) && mb_strlen($value) <= self::EMAIL_MAX && filter_var($value, FILTER_VALIDATE_EMAIL) !== false
                ? [mb_strtolower($value), null]
                : [null, 'Enter a valid e-mail address.'],
            'phone' => is_string($value) && preg_match(self::PHONE_PATTERN, $value) === 1
                ? [$value, null]
                : [null, 'Enter a valid phone number.'],
            'number' => self::number($field, $value),
            'date' => is_string($value) && preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m) === 1 && checkdate((int) $m[2], (int) $m[3], (int) $m[1])
                ? [$value, null]
                : [null, 'Enter a date as YYYY-MM-DD.'],
            'select', 'radio' => self::choice($field, $value),
            'checkbox' => is_bool($value) ? [$value, null] : [false, 'This is ticked or not (true or false).'],
            'checkboxes' => self::choices($field, $value),
            default => [null, 'This field cannot be answered.'],
        };
    }

    /**
     * @param  array<string, mixed>  $field
     * @return array{0: ?string, 1: ?string}
     */
    private static function textAnswer(array $field, mixed $value): array
    {
        if (! is_string($value)) {
            return [null, 'Enter text.'];
        }
        $max = $field['max_length'] ?? ElementRegistry::FORM_DEFAULT_MAX_LENGTH[$field['kind']];
        if (mb_strlen($value) > $max) {
            return [null, "Use at most {$max} characters."];
        }

        return [$value, null];
    }

    /**
     * @param  array<string, mixed>  $field
     * @return array{0: ?string, 1: ?string}
     */
    private static function number(array $field, mixed $value): array
    {
        if (is_int($value)) {
            $value = (string) $value;
        } elseif (is_float($value) && is_finite($value)) {
            $value = (string) json_encode($value);
        }
        if (! is_string($value) || preg_match(self::NUMBER_PATTERN, $value) !== 1) {
            return [null, 'Enter a number (at most 2 decimals).'];
        }
        // Canonical: no leading zeros, no trailing decimal zeros ("007.50" → "7.5").
        $negative = str_starts_with($value, '-');
        [$whole, $fraction] = array_pad(explode('.', ltrim($value, '-')), 2, '');
        $whole = ltrim($whole, '0') === '' ? '0' : ltrim($whole, '0');
        $fraction = rtrim($fraction, '0');
        $canonical = ($negative && ($whole !== '0' || $fraction !== '') ? '-' : '').$whole.($fraction === '' ? '' : '.'.$fraction);

        $min = $field['min'];
        $max = $field['max'];
        if ($min !== null && self::compare($canonical, $min) < 0) {
            return [null, 'Enter at least '.self::plain($min).'.'];
        }
        if ($max !== null && self::compare($canonical, $max) > 0) {
            return [null, 'Enter at most '.self::plain($max).'.'];
        }

        return [$canonical, null];
    }

    /**
     * Compares a decimal string (≤ 2 decimals) with a bound, in hundredths (exact, no floats).
     */
    private static function compare(string $value, int|float $bound): int
    {
        return self::hundredths($value) <=> (int) round(((float) $bound) * 100);
    }

    private static function hundredths(string $value): int
    {
        $negative = str_starts_with($value, '-');
        [$whole, $fraction] = array_pad(explode('.', ltrim($value, '-')), 2, '');
        $cents = ((int) $whole) * 100 + (int) str_pad($fraction, 2, '0');

        return $negative ? -$cents : $cents;
    }

    private static function plain(int|float $number): string
    {
        return is_int($number) ? (string) $number : rtrim(rtrim(number_format($number, 2, '.', ''), '0'), '.');
    }

    /**
     * @param  array<string, mixed>  $field
     * @return array{0: ?string, 1: ?string}
     */
    private static function choice(array $field, mixed $value): array
    {
        foreach ($field['options'] as $option) {
            if ($option['id'] === $value) {
                return [$option['label'], null];
            }
        }

        return [null, 'Choose one of the options.'];
    }

    /**
     * @param  array<string, mixed>  $field
     * @return array{0: ?list<string>, 1: ?string}
     */
    private static function choices(array $field, mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) !== count(array_unique(array_filter($value, 'is_string')))) {
            return [null, 'Choose options from the list.'];
        }
        $labels = [];
        foreach ($field['options'] as $option) {
            if (in_array($option['id'], $value, true)) {
                $labels[] = $option['label'];
            }
        }
        if (count($labels) !== count($value)) {
            return [null, 'Choose options from the list.'];
        }

        return [$labels, null];
    }
}
