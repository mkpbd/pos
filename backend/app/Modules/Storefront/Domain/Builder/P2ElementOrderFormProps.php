<?php

namespace App\Modules\Storefront\Domain\Builder;

/**
 * P2a: props of the `order_form` element (a one-product order page: variant, quantity, an
 * optional add-on, the delivery details and cash on delivery, without a cart step) for
 * BuilderDocumentSchema, like B8ElementFormProps: every key present afterwards (missing keys
 * take the registry defaults), unknown keys dropped, each value checked against its limit.
 *
 * `product_id` is required (the registry default null opens the editor's setup dialog);
 * `quantity.default` ≤ `quantity.max`; `upsell` is null or `{product_id, label}` with another
 * product than the main one. Product ownership is checked by BuilderReferences.
 */
final class P2ElementOrderFormProps extends ElementProps
{
    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $max = ElementRegistry::TRANSLATABLE['order_form'];

        $productId = $this->uuid($this->raw('product_id'), 'product_id', 'Choose the product this form sells.');

        return [
            'product_id' => $productId,
            'title' => $this->text($this->raw('title'), 'title', 0, $max['title']),
            'text' => $this->text($this->raw('text'), 'text', 0, $max['text']),
            'show_variants' => $this->bool('show_variants'),
            'quantity' => $this->quantity($this->raw('quantity')),
            'fields' => $this->fields($this->raw('fields')),
            'payment' => $this->enum('payment', ElementRegistry::ORDER_FORM_PAYMENT),
            'button_label' => $this->text($this->raw('button_label'), 'button_label', 1, $max['button_label'], fallback: 'Confirm order'),
            'success_message' => $this->text($this->raw('success_message'), 'success_message', 1, $max['success_message'], fallback: 'Thank you!'),
            'upsell' => $this->upsell($this->raw('upsell'), $productId, $max['upsell.label']),
            'layout' => $this->enum('layout', ElementRegistry::FORM_LAYOUTS),
        ];
    }

    /**
     * @return array{default: int, max: int}
     */
    private function quantity(mixed $value): array
    {
        $defaults = $this->defaults['quantity'];
        if (! is_array($value)) {
            $this->fail('quantity', 'The quantity is {default, max}.');

            return $defaults;
        }
        $result = [];
        foreach (['default' => ElementRegistry::ORDER_FORM_QUANTITY_DEFAULT, 'max' => ElementRegistry::ORDER_FORM_QUANTITY_MAX] as $key => [$min, $limit]) {
            $number = $value[$key] ?? null;
            if (! is_int($number) || $number < $min || $number > $limit) {
                $this->fail("quantity.{$key}", "Enter a whole number from {$min} to {$limit}.");
                $number = $defaults[$key];
            }
            $result[$key] = $number;
        }
        if ($result['default'] > $result['max']) {
            $this->fail('quantity.default', 'The preselected quantity must not be above the largest quantity.');
            $result['default'] = $result['max'];
        }

        return $result;
    }

    /**
     * @return array{email: string, note: string}
     */
    private function fields(mixed $value): array
    {
        $defaults = $this->defaults['fields'];
        if (! is_array($value)) {
            $this->fail('fields', 'The fields are {email, note}.');

            return $defaults;
        }

        return [
            'email' => $this->enumOf($value['email'] ?? $defaults['email'], 'fields.email', ElementRegistry::ORDER_FORM_EMAIL, $defaults['email']),
            'note' => $this->enumOf($value['note'] ?? $defaults['note'], 'fields.note', ElementRegistry::ORDER_FORM_NOTE, $defaults['note']),
        ];
    }

    /**
     * @return array{product_id: ?string, label: string}|null
     */
    private function upsell(mixed $value, ?string $productId, int $max): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            $this->fail('upsell', 'The add-on is null or {product_id, label}.');

            return null;
        }
        $upsellId = $this->uuid($value['product_id'] ?? null, 'upsell.product_id', 'Choose the add-on product.');
        if ($upsellId !== null && $upsellId === $productId) {
            $this->fail('upsell.product_id', 'The add-on must be another product than the one the form sells.');
        }

        return [
            'product_id' => $upsellId,
            'label' => $this->text($value['label'] ?? null, 'upsell.label', 1, $max, fallback: 'Add this too'),
        ];
    }
}
