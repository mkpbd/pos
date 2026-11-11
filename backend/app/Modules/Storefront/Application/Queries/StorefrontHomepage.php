<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;

/**
 * The homepage as the storefront renders it: sections in order with their banners and
 * media resolved. Only live sections are included, and a section whose banners are all
 * inactive or out of their schedule is left out, so an empty block never renders.
 *
 * The preview (staff only) includes every section with its state, so the admin can see
 * disabled and scheduled sections in place before publishing them.
 *
 * E12b: section titles and subtitles, the text block, newsletter texts and banner texts in
 * the request's language (per-field fallback to the base text); cached per language.
 */
class StorefrontHomepage
{
    public function __construct(
        private readonly SectionContentResolver $sections,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
        private readonly ContentSchedule $schedule,
    ) {}

    /**
     * @return array{sections: list<array<string, mixed>>}
     */
    public function build(bool $preview = false): array
    {
        if ($preview) {
            return $this->compute(true);
        }

        // E12: the public homepage is cached per content version until the next scheduled change.
        return $this->version->remember(
            $this->tenant->requireOrganization(),
            'homepage',
            fn () => $this->compute(false),
            fn () => $this->schedule->nextChange(),
        );
    }

    /**
     * @return array{sections: list<array<string, mixed>>}
     */
    private function compute(bool $preview): array
    {
        $sections = HomepageSection::query()->with('items')->orderBy('sort_order')->get();
        if (! $preview) {
            $sections = $sections->filter(fn (HomepageSection $s) => $s->scheduleState() === 'live');
        }

        // B1: the section content is built by the resolver the store builder shares.
        $content = $this->sections->resolve($sections->map(fn (HomepageSection $s) => [
            'id' => $s->id,
            'type' => $s->type,
            'title' => $s->title,
            'subtitle' => $s->subtitle,
            'config' => $s->config,
            'items' => $s->items->map(fn (HomepageSectionItem $item) => ['item_type' => $item->item_type, 'item_id' => $item->item_id])->values()->all(),
            'translations' => $s->translations,
            'state' => $s->scheduleState(),
        ])->values()->all(), $preview);

        return ['sections' => array_values($content)];
    }
}
