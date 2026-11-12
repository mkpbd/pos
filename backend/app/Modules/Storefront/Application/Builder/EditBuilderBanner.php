<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Actions\ManageBanners;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Infrastructure\BuilderBannerUsage;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Illuminate\Support\Facades\DB;

/**
 * Editing a banner from a builder document (the banners of a hero slider or banner grid), with
 * copy-on-write so a draft never changes the live store:
 *
 * - only this document's draft shows the banner: it is updated in place;
 * - anything else shows or keeps it — a homepage section, another document's draft, any
 *   published version (this document's own included, so the live page and restorable versions
 *   keep their banner) or a saved template: a new banner is created with the submitted values
 *   (same placement, the original's other values, the name suffixed with the document title)
 *   and the editor swaps the id in its draft. The original is unchanged.
 *
 * Popups are shown site-wide by placement, so they are not edited here. The banner's own save is
 * audited by ManageBanners (`banner.updated` / `banner.created`); this adds
 * `storefront.builder_banner_edited` with the document and whether it was copied.
 */
class EditBuilderBanner
{
    private const NAME_MAX = 80;

    private const SEPARATOR = ' · ';

    public function __construct(
        private readonly ManageBanners $banners,
        private readonly BuilderBannerUsage $usage,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated (the banner update rules)
     * @return array{banner: Banner, replaced: array{old_id: string, new_id: string}|null}
     */
    public function edit(BuilderDocument $document, Banner $banner, array $attributes): array
    {
        if ($banner->placement === BannerPlacement::Popup) {
            throw new BusinessRuleViolation('BANNER_NOT_EDITABLE_HERE', 'Popups show on every page; edit them under Online store → Banners.');
        }
        // The element's banners must keep their placement.
        unset($attributes['placement']);

        return DB::transaction(function () use ($document, $banner, $attributes) {
            // Serialize edits of one banner (two tabs, double clicks): the second sees the first's result.
            $banner = Banner::query()->whereKey($banner->id)->lockForUpdate()->firstOrFail();

            if (! $this->usage->usedOutsideDraftOf($banner->id, $document->id)) {
                $saved = $this->banners->save($banner, $attributes);
                $replaced = null;
            } else {
                $copy = $banner->replicate(['sort_order', 'created_by', 'updated_by']);
                $attributes['name'] = self::copyName(is_string($attributes['name'] ?? null) ? $attributes['name'] : $banner->name, $document->title);
                $saved = $this->banners->save($copy, $attributes);
                $replaced = ['old_id' => $banner->id, 'new_id' => $saved->id];
            }

            $this->audit->record('storefront.builder_banner_edited', $document, [], [
                'banner_id' => $saved->id,
                'copied_from' => $replaced['old_id'] ?? null,
            ]);

            return ['banner' => $saved, 'replaced' => $replaced];
        });
    }

    /**
     * "Men" on "Test page" → "Men · Test page", within the 80-character name limit; a name that
     * already ends with the title keeps it once.
     */
    public static function copyName(string $name, string $title): string
    {
        $name = trim($name);
        $title = trim($title);
        $suffix = self::SEPARATOR.$title;
        if (mb_strlen($suffix) > self::NAME_MAX / 2) {
            $suffix = mb_substr($suffix, 0, (int) (self::NAME_MAX / 2) - 1).'…';
        }
        if ($title === '' || str_ends_with($name, $suffix)) {
            return mb_substr($name, 0, self::NAME_MAX);
        }

        return rtrim(mb_substr($name, 0, self::NAME_MAX - mb_strlen($suffix))).$suffix;
    }
}
