<?php

namespace App\Modules\Storefront\Domain\Builder;

/**
 * B17: props of the festival / Bangladesh trust elements for BuilderDocumentSchema, like the
 * other normalizers: every key present afterwards (missing keys take the registry defaults),
 * unknown keys dropped, each value checked against its limit.
 *
 * - ornament: a built-in drawing (`name`), colours (theme role or hex; the flag ribbon always
 *   draws the national flag colours), size, align, flip, opacity, and `repeat` for border
 *   drawings only. Always decorative (aria-hidden in the storefront).
 * - payment_badges: the store's checkout methods (data) and the owner's mobile wallets
 *   (unique, PAYMENT_WALLETS) as text badges.
 * - delivery_promise: `zones` is `all` or 1–12 unique zone ids (resolved through the
 *   Shipping contract, organization-scoped; ids that are not the store's simply show nothing).
 * - bangla_date: today's date in the Bangla calendar, computed by the storefront in the
 *   store's time zone (data).
 */
final class B17ElementProps extends ElementProps
{
    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);
        $max = ElementRegistry::TRANSLATABLE[$type] ?? [];

        return match ($type) {
            'ornament' => $this->ornament(),
            'payment_badges' => [
                'title' => $this->text($this->raw('title'), 'title', 0, $max['title']),
                'show_store_methods' => $this->bool('show_store_methods'),
                'wallets' => $this->wallets($this->raw('wallets')),
                'note' => $this->text($this->raw('note'), 'note', 0, $max['note']),
                'style' => $this->enum('style', ElementRegistry::PAYMENT_BADGE_STYLES),
                'align' => $this->enum('align', ElementRegistry::ALIGNS),
            ],
            'delivery_promise' => [
                'title' => $this->text($this->raw('title'), 'title', 0, $max['title']),
                'zones' => $this->zones($this->raw('zones')),
                'show_price' => $this->bool('show_price'),
                'show_cod' => $this->bool('show_cod'),
                'show_free_over' => $this->bool('show_free_over'),
                'layout' => $this->enum('layout', ElementRegistry::DELIVERY_LAYOUTS),
            ],
            'bangla_date' => [
                'prefix' => $this->text($this->raw('prefix'), 'prefix', 0, $max['prefix']),
                'show_gregorian' => $this->bool('show_gregorian'),
                'show_hijri' => $this->bool('show_hijri'),
                'style' => $this->enum('style', ElementRegistry::BANGLA_DATE_STYLES),
                'align' => $this->enum('align', ElementRegistry::ALIGNS),
            ],
            default => [],
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function ornament(): array
    {
        $name = $this->enum('name', ElementRegistry::ORNAMENT_NAMES);
        $color = StyleSchema::color($this->raw('color'));
        if ($color === null) {
            $this->fail('color', 'Use #rrggbb, #rrggbbaa or a theme colour (theme:<role>).');
            $color = $this->defaults['color'];
        }
        $secondary = $this->raw('secondary_color');
        if ($secondary !== null) {
            $secondary = StyleSchema::color($secondary);
            if ($secondary === null) {
                $this->fail('secondary_color', 'Use #rrggbb, #rrggbbaa, a theme colour (theme:<role>) or nothing.');
            }
        }
        $repeat = $this->bool('repeat');
        if ($repeat && ! in_array($name, ElementRegistry::ORNAMENT_REPEATABLE, true)) {
            $this->fail('repeat', 'Only border drawings repeat across the width.');
            $repeat = false;
        }

        return [
            'name' => $name,
            'color' => $color,
            'secondary_color' => $secondary,
            'size' => $this->int('size', ElementRegistry::ORNAMENT_SIZE),
            'align' => $this->enum('align', ElementRegistry::ALIGNS),
            'flip' => $this->enum('flip', ElementRegistry::ORNAMENT_FLIPS),
            'opacity' => $this->int('opacity', ElementRegistry::ORNAMENT_OPACITY),
            'repeat' => $repeat,
        ];
    }

    /**
     * @return list<string>
     */
    private function wallets(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            $this->fail('wallets', 'The wallets are a list.');

            return [];
        }
        $result = [];
        foreach ($value as $i => $wallet) {
            if (! is_string($wallet) || ! in_array($wallet, ElementRegistry::PAYMENT_WALLETS, true)) {
                $this->fail("wallets.{$i}", 'Choose one of: '.implode(', ', ElementRegistry::PAYMENT_WALLETS).'.');

                continue;
            }
            if (in_array($wallet, $result, true)) {
                $this->fail("wallets.{$i}", 'Each wallet can be listed once.');

                continue;
            }
            $result[] = $wallet;
        }

        return $result;
    }

    /**
     * `all`, or 1–12 unique zone ids (lower-cased).
     *
     * @return string|list<string>
     */
    private function zones(mixed $value): string|array
    {
        if ($value === 'all') {
            return 'all';
        }
        [$min, $max] = ElementRegistry::DELIVERY_ZONES;
        if (! is_array($value) || ! array_is_list($value) || count($value) < $min || count($value) > $max) {
            $this->fail('zones', "Choose \"all\" or {$min} to {$max} delivery zones.");

            return 'all';
        }
        $result = [];
        foreach ($value as $i => $id) {
            $id = $this->uuid($id, "zones.{$i}", 'Choose a delivery zone of the store.');
            if ($id === null) {
                continue;
            }
            if (in_array($id, $result, true)) {
                $this->fail("zones.{$i}", 'Each zone can be chosen once.');

                continue;
            }
            $result[] = $id;
        }

        return $result === [] ? 'all' : $result;
    }
}
