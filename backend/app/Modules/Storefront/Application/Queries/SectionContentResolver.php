<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;

/**
 * The storefront content of homepage-style sections — the object `/store/homepage` returns
 * per section — built from (type, title, subtitle, config, items, translations). Shared by
 * the homepage (StorefrontHomepage) and the store builder's wrapped-section elements (B1),
 * so both render a section type identically.
 *
 * Banners that are inactive or out of their schedule and catalog records that are not
 * visible drop out; a section left without content is omitted, or — in a preview — kept with
 * `state: 'empty'` (when it was live). Texts are in the request's language (E12b).
 *
 * @phpstan-type SectionInput array{id: string, type: SectionType, title: ?string, subtitle: ?string, config: array<string, mixed>, items: list<array{item_type: string, item_id: string}>, translations: mixed, state: string}
 */
class SectionContentResolver
{
    public function __construct(
        private readonly MediaLibrary $media,
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * @param  list<SectionInput>  $sections  `items` in display order; `state` is the section's own
     *                                        (`live`, `disabled`, `scheduled`, …), used in a preview
     * @return array<string, array<string, mixed>> section id => content, in input order; omitted sections are absent
     */
    public function resolve(array $sections, bool $preview): array
    {
        $bannerIds = [];
        foreach ($sections as $section) {
            foreach ($section['items'] as $item) {
                if ($item['item_type'] === HomepageSectionItem::TYPE_BANNER) {
                    $bannerIds[] = $item['item_id'];
                }
            }
        }
        $bannerIds = array_values(array_unique($bannerIds));
        $banners = $bannerIds === [] ? collect() : Banner::query()->live()->whereIn('id', $bannerIds)->get()->keyBy('id');

        $mediaIds = $banners->flatMap(fn (Banner $b) => array_filter([$b->desktop_media_id, $b->mobile_media_id]))->all();
        foreach ($sections as $section) {
            array_push($mediaIds, ...$section['type']->mediaIds($section['type']->normalize($section['config'])));
        }
        $refs = $this->media->refs(array_values(array_unique($mediaIds)));
        $ref = fn (?string $id) => $id !== null ? ($refs[$id] ?? null) : null;

        $result = [];
        foreach ($sections as $section) {
            $type = $section['type'];
            $config = $type->normalize($section['config']);
            $state = $section['state'];

            $sectionBanners = [];
            if ($type->bannerPlacement() !== null) {
                foreach ($section['items'] as $item) {
                    if ($item['item_type'] !== HomepageSectionItem::TYPE_BANNER) {
                        continue;
                    }
                    $banner = $banners->get($item['item_id']);
                    if ($banner !== null && $banner->desktop_media_id !== null && $ref($banner->desktop_media_id) !== null) {
                        $sectionBanners[] = $this->banner($banner, $ref);
                    }
                }
                if ($sectionBanners === []) {
                    if (! $preview) {
                        continue;
                    }
                    $state = $state === 'live' ? 'empty' : $state;
                }
            }

            $catalogContent = $this->catalogContent($section, $type, $config);
            if ($catalogContent !== null && $this->isEmpty($catalogContent)) {
                if (! $preview) {
                    continue;
                }
                $state = $state === 'live' ? 'empty' : $state;
            }

            $locale = $this->locale->current();
            $data = [
                'id' => $section['id'],
                'type' => $type->value,
                'title' => Translations::value($section['translations'], 'title', $locale, $section['title']),
                'subtitle' => Translations::value($section['translations'], 'subtitle', $locale, $section['subtitle']),
                'config' => $this->publicConfig($type, $this->localizeConfig($section['translations'], $type, $config), $ref),
            ];
            if ($type->bannerPlacement() !== null) {
                $data['banners'] = $sectionBanners;
            }
            $data += $catalogContent ?? [];
            if ($preview) {
                $data['state'] = $state;
            }
            $result[$section['id']] = $data;
        }

        return $result;
    }

    /**
     * Products, categories or brands of a catalog section, from the online catalog, or the
     * posts of a blog section; null for other section types. Records that are not (or no longer) live or visible drop out.
     *
     * @param  SectionInput  $section
     * @param  array<string, mixed>  $config  normalized
     * @return array<string, mixed>|null
     */
    private function catalogContent(array $section, SectionType $type, array $config): ?array
    {
        $manual = $type->manualItemLimits();
        $picked = fn () => array_values(array_column(array_filter($section['items'], fn (array $item) => $item['item_type'] === $manual['type']), 'item_id'));

        return match ($type) {
            SectionType::ProductCarousel, SectionType::ProductGrid => ['products' => $config['source'] === 'manual'
                ? array_slice($this->catalog->productCards($picked()), 0, $config['limit'])
                : $this->catalog->sourceProductCards($config['source'], $config['category_id'], $config['limit'])],
            SectionType::ProductTabs => ['tabs' => array_values(array_filter(array_map(fn (array $tab) => [
                'label' => $tab['label'],
                'products' => $this->catalog->sourceProductCards($tab['source'], $tab['category_id'], $config['limit']),
            ], $config['tabs']), fn (array $tab) => $tab['products'] !== []))],
            SectionType::CategoryStrip => ['categories' => $this->catalog->categoryStrip($config['source'] === 'manual' ? $picked() : null, $config['limit'])],
            SectionType::BrandStrip => ['brands' => $this->catalog->brandStrip($config['source'] === 'manual' ? $picked() : null, $config['limit'])],
            SectionType::HotDeals => $this->hotDeals($config),
            // E11: the newest readable blog posts (public list rows).
            SectionType::BlogPosts => ['posts' => $this->blog->postCards(is_string($config['category_id']) ? $config['category_id'] : null, (int) $config['limit'])],
            default => null,
        };
    }

    /**
     * Products of the live countdown promotions (cards carry their promotion) and the
     * earliest end among them, which the section counts down to.
     *
     * @param  array<string, mixed>  $config  normalized
     * @return array{products: list<array<string, mixed>>, ends_at: ?string}
     */
    private function hotDeals(array $config): array
    {
        $products = $this->catalog->hotDealCards(is_string($config['promotion_id']) ? $config['promotion_id'] : null, (int) $config['limit']);
        $ends = array_values(array_filter(array_map(fn (array $card) => $card['promotion']['ends_at'] ?? null, $products)));
        usort($ends, fn (string $a, string $b) => strtotime($a) <=> strtotime($b));

        return ['products' => $products, 'ends_at' => $ends[0] ?? null];
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function isEmpty(array $content): bool
    {
        return array_key_exists('products', $content) ? $content['products'] === [] : reset($content) === [];
    }

    /**
     * @return array<string, mixed>
     */
    private function banner(Banner $b, callable $ref): array
    {
        $text = Translations::pickMany($b, ['kicker', 'title', 'subtitle', 'button_label', 'secondary_button_label'], $this->locale->current());

        return [
            'id' => $b->id,
            'kicker' => $text['kicker'],
            'title' => $text['title'],
            'subtitle' => $text['subtitle'],
            'link_url' => $b->link_url,
            'button_label' => $text['button_label'],
            'secondary_link_url' => $b->secondary_link_url,
            'secondary_button_label' => $text['secondary_button_label'],
            'image' => $ref($b->desktop_media_id),
            'mobile_image' => $ref($b->mobile_media_id),
            'text_color' => $b->text_color,
            'text_position' => $b->text_position,
        ];
    }

    /**
     * The config's translatable texts (text block, newsletter) in the request's language.
     *
     * @param  array<string, mixed>  $config  normalized
     * @return array<string, mixed>
     */
    private function localizeConfig(mixed $translations, SectionType $type, array $config): array
    {
        foreach ($type->translatableConfigFields() as $field) {
            $config[$field] = Translations::value($translations, $field, $this->locale->current(), $config[$field] ?? null);
        }

        return $config;
    }

    /**
     * Media ids in the config become media objects.
     *
     * @param  array<string, mixed>  $config  normalized
     * @return array<string, mixed>
     */
    private function publicConfig(SectionType $type, array $config, callable $ref): array
    {
        return match ($type) {
            SectionType::Testimonials => [
                ...$config,
                'items' => array_map(function (array $item) use ($ref) {
                    $item['avatar'] = $ref($item['avatar_media_id']);
                    unset($item['avatar_media_id']);

                    return $item;
                }, $config['items']),
            ],
            SectionType::Newsletter => (function () use ($config, $ref) {
                $config['image'] = $ref($config['image_media_id']);
                unset($config['image_media_id']);

                return $config;
            })(),
            default => $config,
        };
    }
}
