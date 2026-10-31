<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\Instants;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\ScheduleWindow;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;
use Illuminate\Support\Facades\DB;

/**
 * The homepage builder: save a section with its config and attached banners, duplicate,
 * delete and reorder. A section's type never changes after creation. New sections go last.
 */
class ManageHomepageSections
{
    public const MAX_SECTIONS = 40;

    /** Banners a banner-grid layout needs at least (the split layout exactly). */
    private const GRID_MINIMUM = ['2-col' => 2, '3-col' => 3, '3-col-split' => 4, '4-col' => 4];

    public function __construct(
        private readonly MediaLibrary $media,
        private readonly HtmlSanitizer $sanitizer,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated; `config` and `banner_ids` optional on update
     */
    public function save(HomepageSection $section, array $attributes): HomepageSection
    {
        $creating = ! $section->exists;
        $type = $creating ? SectionType::from($attributes['type']) : $section->type;
        unset($attributes['type']);

        $attributes = Instants::normalize($attributes, ['starts_at', 'ends_at']);
        $bannerIds = array_key_exists('banner_ids', $attributes) ? array_values($attributes['banner_ids'] ?? []) : null;
        unset($attributes['banner_ids']);

        if (array_key_exists('config', $attributes) || $creating) {
            $attributes['config'] = $this->prepareConfig($type, (array) ($attributes['config'] ?? []));
        }
        $config = $attributes['config'] ?? $section->config;
        if ($type->itemLimits() !== null && ($creating || $bannerIds !== null || array_key_exists('config', $attributes))) {
            $this->checkBanners($type, $config, $bannerIds ?? $this->bannerIds($section));
        }

        return DB::transaction(function () use ($section, $attributes, $type, $bannerIds, $creating) {
            $before = $creating ? [] : $this->snapshot($section);

            if ($creating) {
                if (HomepageSection::query()->count() >= self::MAX_SECTIONS) {
                    throw new BusinessRuleViolation('LIMIT_REACHED', 'The homepage can have at most '.self::MAX_SECTIONS.' sections.');
                }
                $section->type = $type;
                $section->sort_order = (int) HomepageSection::query()->max('sort_order') + 1;
            }
            $section->fill($attributes);
            ScheduleWindow::assertValid($section->starts_at, $section->ends_at);
            $section->save();

            if ($bannerIds !== null && $type->itemLimits() !== null) {
                $this->replaceItems($section, $bannerIds);
            }

            [$old, $new] = Changes::between($before, $this->snapshot($section));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'homepage_section.created' : 'homepage_section.updated', $section, $old, $new);
            }

            return $section->load('items');
        });
    }

    /**
     * A disabled copy placed right after the original, so it can be edited before it goes live.
     */
    public function duplicate(HomepageSection $section): HomepageSection
    {
        return DB::transaction(function () use ($section) {
            if (HomepageSection::query()->count() >= self::MAX_SECTIONS) {
                throw new BusinessRuleViolation('LIMIT_REACHED', 'The homepage can have at most '.self::MAX_SECTIONS.' sections.');
            }
            HomepageSection::query()->where('sort_order', '>', $section->sort_order)->increment('sort_order');

            $copy = $section->replicate(['created_by', 'updated_by']);
            $copy->title = $section->title === null ? null : mb_substr($section->title.' (copy)', 0, 120);
            $copy->is_enabled = false;
            $copy->sort_order = $section->sort_order + 1;
            $copy->save();
            $this->replaceItems($copy, $this->bannerIds($section));

            $this->audit->record('homepage_section.duplicated', $copy, [], ['from' => $section->id]);

            return $copy->load('items');
        });
    }

    public function delete(HomepageSection $section): void
    {
        DB::transaction(function () use ($section) {
            $section->delete();
            $this->audit->record('homepage_section.deleted', $section, $this->snapshot($section));
        });
    }

    /**
     * @param  list<string>  $ids  every section id, in the new order
     */
    public function reorder(array $ids): void
    {
        DB::transaction(function () use ($ids) {
            $existing = HomepageSection::query()->lockForUpdate()->pluck('id')->all();
            if (count($ids) !== count($existing) || array_diff($existing, $ids) !== []) {
                throw new BusinessRuleViolation('ORDER_MISMATCH', 'Send every section exactly once. Reload the list and try again.');
            }

            foreach (array_values($ids) as $position => $id) {
                HomepageSection::query()->whereKey($id)->update(['sort_order' => $position]);
            }
            $this->audit->record('homepage.reordered', null, [], ['ids' => array_values($ids)]);
        });
    }

    /**
     * Normalizes the config, sanitizes rich text and checks referenced media.
     *
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    private function prepareConfig(SectionType $type, array $config): array
    {
        $config = $type->normalize($config);

        if ($type === SectionType::RichText) {
            $config['body_html'] = $this->sanitizer->clean((string) $config['body_html']);
            if (trim(strip_tags($config['body_html'], '<img>')) === '') {
                throw new BusinessRuleViolation('CONTENT_EMPTY', 'The text block has no content left after removing unsupported formatting.');
            }
        }

        $mediaIds = $type->mediaIds($config);
        $missing = array_values(array_diff($mediaIds, $this->media->existing($mediaIds)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'Some selected images no longer exist in the media library.', ['media_ids' => $missing]);
        }

        return $config;
    }

    /**
     * @param  array<string, mixed>  $config
     * @param  list<string>  $bannerIds
     */
    private function checkBanners(SectionType $type, array $config, array $bannerIds): void
    {
        ['min' => $min, 'max' => $max] = $type->itemLimits();
        if ($type === SectionType::BannerGrid) {
            $min = self::GRID_MINIMUM[$config['layout']] ?? $min;
            $max = $config['layout'] === '3-col-split' ? 4 : $max;
        }
        if (count($bannerIds) < $min || count($bannerIds) > $max) {
            throw new BusinessRuleViolation('SECTION_ITEMS_INVALID', $min === $max
                ? "This layout needs exactly {$min} banners."
                : "Choose between {$min} and {$max} banners for this section.");
        }

        $found = Banner::query()->whereIn('id', $bannerIds)->where('placement', $type->bannerPlacement())->pluck('id')->all();
        $invalid = array_values(array_diff($bannerIds, $found));
        if ($invalid !== []) {
            throw new BusinessRuleViolation('BANNER_NOT_FOUND', 'Some selected banners do not exist or belong to another placement.', ['banner_ids' => $invalid]);
        }
    }

    /**
     * @param  list<string>  $bannerIds
     */
    private function replaceItems(HomepageSection $section, array $bannerIds): void
    {
        $section->items()->delete();
        foreach ($bannerIds as $position => $id) {
            HomepageSectionItem::query()->create([
                'section_id' => $section->id,
                'item_type' => HomepageSectionItem::TYPE_BANNER,
                'item_id' => $id,
                'sort_order' => $position,
            ]);
        }
    }

    /**
     * @return list<string>
     */
    private function bannerIds(HomepageSection $section): array
    {
        return $section->items()->where('item_type', HomepageSectionItem::TYPE_BANNER)->pluck('item_id')->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(HomepageSection $section): array
    {
        return [
            'type' => $section->type->value,
            'title' => $section->title,
            'subtitle' => $section->subtitle,
            'config_hash' => hash('xxh128', (string) json_encode($section->config)),
            'banner_ids' => $section->exists ? $this->bannerIds($section) : [],
            'is_enabled' => $section->is_enabled,
            'starts_at' => $section->starts_at?->toIso8601String(),
            'ends_at' => $section->ends_at?->toIso8601String(),
        ];
    }
}
