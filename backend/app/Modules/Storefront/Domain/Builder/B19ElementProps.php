<?php

namespace App\Modules\Storefront\Domain\Builder;

use App\Modules\Storefront\Domain\LinkTarget;

/**
 * B19: props of the scroll story elements for BuilderDocumentSchema, like the other
 * normalizers: every key present afterwards (missing keys take the registry defaults), unknown
 * keys dropped, each value checked against its limit.
 *
 * - scroll_story: 2–6 `steps` `{id, media_id|null, alt, kicker, heading, text, link: null |
 *   {label, url}}` beside a sticky picture (`media_side`, `media_ratio`, `transition`,
 *   `progress_dots`). A step's picture may still be unchosen (null): the page check reminds,
 *   the storefront shows the step's text without it. Texts are plain text.
 * - horizontal_gallery: `source` images (2–12 `items` `{id, media_id|null, alt, caption, link}`)
 *   or products (2–12 unique `product_ids`, shown with their storefront cards); the list of the
 *   other source is emptied. `card_width`, `pin` (pinned sideways scroll on desktop),
 *   `show_progress`.
 *
 * Ownership of the media and products is checked by Application\Builder\BuilderReferences.
 */
final class B19ElementProps extends ElementProps
{
    /**
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>
     */
    public function normalize(string $type, array $props): array
    {
        $this->start($type, $props);

        return match ($type) {
            'scroll_story' => $this->scrollStory(),
            'horizontal_gallery' => $this->horizontalGallery(),
            default => [],
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function scrollStory(): array
    {
        $max = fn (string $field) => ElementRegistry::B19_TEXT_LIMITS["scroll_story.steps.{$field}"];

        return [
            'steps' => $this->list('steps', ElementRegistry::LIST_LIMITS['scroll_story.steps'], fn (array $step, string $path) => [
                'media_id' => $this->media($step['media_id'] ?? null, "{$path}.media_id"),
                'alt' => $this->text($step['alt'] ?? null, "{$path}.alt", 0, $max('alt')),
                'kicker' => $this->text($step['kicker'] ?? null, "{$path}.kicker", 0, $max('kicker')),
                'heading' => $this->text($step['heading'] ?? null, "{$path}.heading", 1, $max('heading')),
                'text' => $this->text($step['text'] ?? null, "{$path}.text", 0, $max('text')),
                'link' => $this->labelledLink($step['link'] ?? null, "{$path}.link", $max('link.label')),
            ]),
            'media_side' => $this->enum('media_side', ElementRegistry::SCROLL_STORY_MEDIA_SIDES),
            'media_ratio' => $this->enum('media_ratio', ElementRegistry::SCROLL_STORY_MEDIA_RATIOS),
            'transition' => $this->enum('transition', ElementRegistry::SCROLL_STORY_TRANSITIONS),
            'progress_dots' => $this->bool('progress_dots'),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function horizontalGallery(): array
    {
        $source = $this->enum('source', ElementRegistry::HORIZONTAL_GALLERY_SOURCES);
        $max = fn (string $field) => ElementRegistry::B19_TEXT_LIMITS["horizontal_gallery.items.{$field}"];

        return [
            'source' => $source,
            // Only the list of the chosen source is kept.
            'items' => $source !== 'images' ? [] : $this->list('items', ElementRegistry::LIST_LIMITS['horizontal_gallery.items'], fn (array $item, string $path) => [
                'media_id' => $this->media($item['media_id'] ?? null, "{$path}.media_id"),
                'alt' => $this->text($item['alt'] ?? null, "{$path}.alt", 0, $max('alt')),
                'caption' => $this->text($item['caption'] ?? null, "{$path}.caption", 0, $max('caption')),
                'link' => $this->link($item['link'] ?? null, "{$path}.link"),
            ]),
            'product_ids' => $source !== 'products' ? [] : $this->productIds($this->raw('product_ids')),
            'card_width' => $this->enum('card_width', ElementRegistry::HORIZONTAL_GALLERY_CARD_WIDTHS),
            'pin' => $this->bool('pin'),
            'show_progress' => $this->bool('show_progress'),
        ];
    }

    /**
     * A picture of the media library, or null while none is chosen.
     */
    private function media(mixed $value, string $path): ?string
    {
        return $this->nullableUuid($value, $path, 'Choose an image from the media library.');
    }

    /**
     * `null` or `{label, url}` — a step's link with its own text.
     *
     * @return array{label: string, url: string}|null
     */
    private function labelledLink(mixed $value, string $path, int $max): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value)) {
            $this->fail($path, 'A link is null or {label, url}.');

            return null;
        }
        $label = $this->text($value['label'] ?? null, "{$path}.label", 1, $max);
        $url = $value['url'] ?? null;
        if (! is_string($url) || ! LinkTarget::isSafe($url)) {
            $this->fail("{$path}.url", 'The link must be a site path such as /sale or an http(s) URL.');

            return null;
        }

        return $label === '' ? null : ['label' => $label, 'url' => $url];
    }

    /**
     * 2–12 unique product ids (lower-cased).
     *
     * @return list<string>
     */
    private function productIds(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            $this->fail('product_ids', 'Choose the products to show.');

            return [];
        }
        [$min, $max] = ElementRegistry::LIST_LIMITS['horizontal_gallery.product_ids'];
        if (count($value) < $min || count($value) > $max) {
            $this->fail('product_ids', "Choose {$min} to {$max} products.");
        }
        $ids = [];
        foreach ($value as $i => $id) {
            $id = $this->uuid($id, "product_ids.{$i}", 'Choose a product.');
            if ($id === null) {
                continue;
            }
            if (in_array($id, $ids, true)) {
                $this->fail("product_ids.{$i}", 'This product is already in the gallery.');

                continue;
            }
            $ids[] = $id;
        }

        return $ids;
    }
}
