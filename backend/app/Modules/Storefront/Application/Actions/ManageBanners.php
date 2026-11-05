<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\Instants;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Domain\ScheduleWindow;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;
use Illuminate\Support\Facades\DB;

/**
 * Banners: save, delete (not while a homepage section shows them) and reorder per placement.
 * New banners go last in their placement.
 */
class ManageBanners
{
    public const MAX_PER_PLACEMENT = 50;

    /** E12b: translatable texts with the limits of the base fields. */
    public const TRANSLATABLE = [
        'kicker' => ['max:60'],
        'title' => ['max:120'],
        'subtitle' => ['max:255'],
        'button_label' => ['max:40'],
        'secondary_button_label' => ['max:40'],
    ];

    public function __construct(
        private readonly MediaLibrary $media,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     */
    public function save(Banner $banner, array $attributes): Banner
    {
        $mediaIds = array_values(array_filter([$attributes['desktop_media_id'] ?? null, $attributes['mobile_media_id'] ?? null], 'is_string'));
        $missing = array_values(array_diff($mediaIds, $this->media->existing($mediaIds)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'Some selected images no longer exist in the media library.', ['media_ids' => $missing]);
        }

        $attributes = Instants::normalize($attributes, ['starts_at', 'ends_at']);

        return DB::transaction(function () use ($banner, $attributes) {
            $creating = ! $banner->exists;
            $before = $creating ? [] : $this->snapshot($banner);

            if (array_key_exists('translations', $attributes)) {
                $attributes['translations'] = TranslationInput::apply($banner->translations, $attributes['translations'], array_keys(self::TRANSLATABLE));
            }
            $banner->fill($attributes);
            // Popup settings (E11) belong to popups only; popups get the defaults for what is unset.
            if ($banner->placement === BannerPlacement::Popup) {
                $banner->popup_delay_seconds ??= BannerPlacement::POPUP_DEFAULTS['popup_delay_seconds'];
                $banner->popup_frequency ??= BannerPlacement::POPUP_DEFAULTS['popup_frequency'];
            } else {
                $banner->popup_delay_seconds = null;
                $banner->popup_frequency = null;
            }
            ScheduleWindow::assertValid($banner->starts_at, $banner->ends_at);
            if (($banner->button_label !== null && $banner->link_url === null)
                || (($banner->secondary_button_label === null) !== ($banner->secondary_link_url === null))) {
                throw new BusinessRuleViolation('BUTTON_LINK_REQUIRED', 'Every button needs both a label and a link.');
            }
            if (! $creating && $banner->isDirty('placement') && $this->usedBy($banner) !== []) {
                throw new BusinessRuleViolation('BANNER_IN_USE', 'This banner is shown by a homepage section, so its placement cannot change. Remove it from the section first.');
            }
            if ($creating || $banner->isDirty('placement')) {
                $count = Banner::query()->where('placement', $banner->placement)->count();
                if ($count >= self::MAX_PER_PLACEMENT) {
                    throw new BusinessRuleViolation('LIMIT_REACHED', 'A placement can have at most '.self::MAX_PER_PLACEMENT.' banners.');
                }
                $banner->sort_order = (int) Banner::query()->where('placement', $banner->placement)->max('sort_order') + 1;
            }
            $banner->save();

            [$old, $new] = Changes::between($before, $this->snapshot($banner));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'banner.created' : 'banner.updated', $banner, $old, $new);
            }

            return $banner;
        });
    }

    public function delete(Banner $banner): void
    {
        $sections = $this->usedBy($banner);
        if ($sections !== []) {
            throw new BusinessRuleViolation('IN_USE', 'This banner is shown by a homepage section. Remove it there first.', ['sections' => $sections]);
        }

        DB::transaction(function () use ($banner) {
            $banner->delete();
            $this->audit->record('banner.deleted', $banner, $this->snapshot($banner));
        });
    }

    /**
     * @param  list<string>  $ids  every banner id of the placement, in the new order
     */
    public function reorder(BannerPlacement $placement, array $ids): void
    {
        DB::transaction(function () use ($placement, $ids) {
            $existing = Banner::query()->where('placement', $placement)->lockForUpdate()->pluck('id')->all();
            if (count($ids) !== count($existing) || array_diff($existing, $ids) !== []) {
                throw new BusinessRuleViolation('ORDER_MISMATCH', 'Send every banner of this placement exactly once. Reload the list and try again.');
            }

            foreach (array_values($ids) as $position => $id) {
                Banner::query()->whereKey($id)->update(['sort_order' => $position]);
            }
            // Mass updates fire no model events: invalidate cached storefront reads (E12).
            app(StorefrontContentVersion::class)->bump(app(TenantContext::class)->requireOrganization());
            $this->audit->record('banners.reordered', null, [], ['placement' => $placement->value, 'ids' => array_values($ids)]);
        });
    }

    /**
     * Sections showing this banner.
     *
     * @return list<array{id: string, title: string}>
     */
    public function usedBy(Banner $banner): array
    {
        $sectionIds = HomepageSectionItem::query()
            ->where('item_type', HomepageSectionItem::TYPE_BANNER)
            ->where('item_id', $banner->id)
            ->pluck('section_id')->all();

        return HomepageSection::query()->whereIn('id', $sectionIds)->orderBy('sort_order')->get()
            ->map(fn (HomepageSection $s) => ['id' => $s->id, 'title' => $s->title ?? $s->type->label()])
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Banner $banner): array
    {
        return [
            'placement' => $banner->placement->value,
            'name' => $banner->name,
            'kicker' => $banner->kicker,
            'title' => $banner->title,
            'subtitle' => $banner->subtitle,
            'link_url' => $banner->link_url,
            'button_label' => $banner->button_label,
            'secondary_link_url' => $banner->secondary_link_url,
            'secondary_button_label' => $banner->secondary_button_label,
            'desktop_media_id' => $banner->desktop_media_id,
            'mobile_media_id' => $banner->mobile_media_id,
            'text_color' => $banner->text_color,
            'text_position' => $banner->text_position,
            'popup_delay_seconds' => $banner->popup_delay_seconds,
            'popup_frequency' => $banner->popup_frequency,
            'starts_at' => $banner->starts_at?->toIso8601String(),
            'ends_at' => $banner->ends_at?->toIso8601String(),
            'is_active' => $banner->is_active,
            'translations' => $banner->translations,
        ];
    }
}
