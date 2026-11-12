<?php

namespace App\Modules\Storefront\Domain\Builder;

/**
 * B8b: props of the `form` element (the form builder) for BuilderDocumentSchema, like
 * B8ElementProps: every key present afterwards (missing keys take the registry defaults),
 * unknown keys dropped, each value checked against its limit.
 *
 * Each field has every key: `options` only for select / radio / checkboxes (2–20, otherwise
 * `[]`), `min` / `max` only for number fields (otherwise null), `max_length` only for text and
 * textarea fields (null = the default length, otherwise null); values that don't apply to a
 * field's kind are dropped silently, so switching the kind in the editor never blocks a save.
 * At most one e-mail field is the reply-to address. No file uploads.
 */
final class B8ElementFormProps extends ElementProps
{
    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $max = fn (string $key) => ElementRegistry::B8B_TEXT_LIMITS["form.{$key}"] ?? ElementRegistry::TRANSLATABLE['form'][$key];

        $replyTo = 0;
        $fields = $this->list('fields', ElementRegistry::LIST_LIMITS['form.fields'], function (array $field, string $path) use ($max, &$replyTo) {
            $kind = $this->enumOf($field['kind'] ?? null, "{$path}.kind", ElementRegistry::FORM_FIELD_KINDS, 'text');
            $result = [
                'kind' => $kind,
                'label' => $this->text($field['label'] ?? null, "{$path}.label", 1, $max('fields.label')),
                'placeholder' => $this->text($field['placeholder'] ?? null, "{$path}.placeholder", 0, $max('fields.placeholder')),
                'help' => $this->text($field['help'] ?? null, "{$path}.help", 0, $max('fields.help')),
                'required' => $this->boolOf($field['required'] ?? false, "{$path}.required"),
                'options' => in_array($kind, ElementRegistry::FORM_CHOICE_KINDS, true)
                    ? $this->listOf($field['options'] ?? [], "{$path}.options", ElementRegistry::LIST_LIMITS['form.fields.options'], fn (array $option, string $optionPath) => [
                        'label' => $this->text($option['label'] ?? null, "{$optionPath}.label", 1, $max('fields.options.label')),
                    ])
                    : [],
                'min' => null,
                'max' => null,
                'max_length' => null,
                'reply_to' => $this->boolOf($field['reply_to'] ?? false, "{$path}.reply_to"),
            ];
            if ($kind === 'number') {
                $bound = [-ElementRegistry::FORM_NUMBER_BOUND, ElementRegistry::FORM_NUMBER_BOUND];
                $result['min'] = ($field['min'] ?? null) === null ? null : $this->decimal($field['min'], "{$path}.min", $bound, 2);
                $result['max'] = ($field['max'] ?? null) === null ? null : $this->decimal($field['max'], "{$path}.max", $bound, 2);
                if ($result['min'] !== null && $result['max'] !== null && $result['min'] > $result['max']) {
                    $this->fail("{$path}.max", 'The largest number must not be below the smallest.');
                }
            }
            if (in_array($kind, ['text', 'textarea'], true) && ($field['max_length'] ?? null) !== null) {
                $length = $field['max_length'];
                [$min, $maxLength] = ElementRegistry::FORM_MAX_LENGTH;
                if (is_int($length) && $length >= $min && $length <= $maxLength) {
                    $result['max_length'] = $length;
                } else {
                    $this->fail("{$path}.max_length", "Enter a whole number from {$min} to {$maxLength}, or leave it empty.");
                }
            }
            if ($result['reply_to']) {
                if ($kind !== 'email') {
                    $this->fail("{$path}.reply_to", 'Only an e-mail field can be the address to reply to.');
                } elseif (++$replyTo > 1) {
                    $this->fail("{$path}.reply_to", 'Only one e-mail field can be the address to reply to.');
                }
            }

            return $result;
        });

        return [
            'title' => $this->text($this->raw('title'), 'title', 0, $max('title')),
            'text' => $this->text($this->raw('text'), 'text', 0, $max('text')),
            'fields' => $fields,
            'submit_label' => $this->text($this->raw('submit_label'), 'submit_label', 1, $max('submit_label'), fallback: 'Send'),
            'success_message' => $this->text($this->raw('success_message'), 'success_message', 1, $max('success_message'), fallback: 'Thank you!'),
            'consent' => $this->consent($this->raw('consent'), $max('consent.text')),
            'notify_email' => $this->email($this->raw('notify_email')),
            'layout' => $this->enum('layout', ElementRegistry::FORM_LAYOUTS),
        ];
    }

    /**
     * null, or `{text, link: null | {url}}` (a required tick box on the store).
     *
     * @return array{text: string, link: array{url: string}|null}|null
     */
    private function consent(mixed $value, int $max): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            $this->fail('consent', 'The consent is null or {text, link}.');

            return null;
        }

        return [
            'text' => $this->text($value['text'] ?? null, 'consent.text', 1, $max),
            'link' => $this->link($value['link'] ?? null, 'consent.link'),
        ];
    }

    private function email(mixed $value): ?string
    {
        if ($value === null || (is_string($value) && trim($value) === '')) {
            return null;
        }
        $max = ElementRegistry::B8B_TEXT_LIMITS['form.notify_email'];
        if (is_string($value) && mb_strlen($value) <= $max && filter_var(trim($value), FILTER_VALIDATE_EMAIL) !== false) {
            return mb_strtolower(trim($value));
        }
        $this->fail('notify_email', 'Enter one e-mail address, or leave it empty.');

        return null;
    }
}
