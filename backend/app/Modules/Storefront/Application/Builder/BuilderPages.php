<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\ContentSchedule;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;

/**
 * Builder pages as the storefront reads them (B1): the published render payload of the home
 * page or a landing page (cached per content version and language until the next scheduled
 * change, like /store/homepage), the staff draft preview (never cached), whether a builder
 * home page is live (bootstrap) and page titles for the HTML shell.
 *
 * B4: the same for the store header and footer and the shop / product zones (bootstrap
 * `builder.header`, `builder.footer`, `builder.zones`) and for CMS pages designed with the
 * builder (`cms:<page id>`, served with GET /store/pages/{slug}).
 */
class BuilderPages
{
    public function __construct(
        private readonly BuilderPageRenderer $renderer,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
        private readonly ContentSchedule $schedule,
        private readonly BuilderElementData $elementData,
    ) {}

    /**
     * `home`, or the document key of a landing page slug.
     */
    public static function key(string $slug): string
    {
        return $slug === BuilderDocument::HOME ? BuilderDocument::HOME : BuilderDocument::LANDING_PREFIX.$slug;
    }

    /**
     * The published page, or null when the document does not exist or was never published.
     *
     * @return array<string, mixed>|null
     */
    public function published(string $key): ?array
    {
        return $this->version->remember(
            $this->tenant->requireOrganization(),
            'builder:'.$key,
            fn () => $this->render($key, 'published'),
            fn () => $this->nextChange([$key]),
        );
    }

    /**
     * The draft of the page (staff preview), or null when there is no such document.
     *
     * @return array<string, mixed>|null
     */
    public function draft(string $key): ?array
    {
        return $this->render($key, 'draft');
    }

    /**
     * B4: the header, footer and zones for the bootstrap — published, or the drafts (any
     * document that exists, published or not) for a staff draft preview.
     *
     * @return array{header: array<string, mixed>|null, footer: array<string, mixed>|null, zones: array<string, array<string, mixed>|null>}
     */
    public function parts(bool $draft): array
    {
        $payload = fn (string $key) => $draft ? $this->draft($key) : $this->published($key);
        $zones = [];
        foreach (BuilderDocument::ZONES as $zone) {
            $zones[$zone] = $payload(BuilderDocument::ZONE_PREFIX.$zone);
        }

        return [
            'header' => $payload(BuilderDocument::HEADER),
            'footer' => $payload(BuilderDocument::FOOTER),
            'zones' => $zones,
        ];
    }

    /**
     * B4: when the published header, footer or zones change on their own (schedules, countdowns,
     * promotions), for the bootstrap cache.
     */
    public function partsNextChange(): ?CarbonImmutable
    {
        return $this->nextChange([BuilderDocument::HEADER, BuilderDocument::FOOTER, ...array_map(fn (string $z) => BuilderDocument::ZONE_PREFIX.$z, BuilderDocument::ZONES)], false);
    }

    /**
     * B4: the design of a CMS page — published (cached), or the draft for a staff preview.
     *
     * @return array<string, mixed>|null
     */
    public function cmsPage(string $pageId, bool $draft): ?array
    {
        $key = BuilderDocument::CMS_PREFIX.strtolower($pageId);

        return $draft ? $this->draft($key) : $this->published($key);
    }

    /**
     * @param  'published'|'draft'  $source
     * @return array<string, mixed>|null
     */
    public function render(string $key, string $source): ?array
    {
        $document = BuilderDocument::query()->builder()->with('publishedVersion')->where('key', $key)->first();
        if ($document === null) {
            return null;
        }

        return $this->renderDocument($document, $source);
    }

    /**
     * @param  'published'|'draft'  $source
     * @return array<string, mixed>|null null when the published source is asked for and none exists
     */
    public function renderDocument(BuilderDocument $document, string $source): ?array
    {
        if ($source === 'draft') {
            return $this->renderer->render($document, $document->draft, null, 'draft');
        }
        $version = $document->publishedVersion;

        return $version === null ? null : $this->renderer->render($document, $version->content, $version->number, 'published');
    }

    public function hasPublishedHome(): bool
    {
        return BuilderDocument::query()->where('key', BuilderDocument::HOME)->whereNotNull('published_version_id')->exists();
    }

    /**
     * Title of a landing page the shell may serve: published, or any existing one for a
     * staff draft preview.
     */
    public function landingTitle(string $slug, bool $draft): ?string
    {
        $query = BuilderDocument::query()->where('key', BuilderDocument::LANDING_PREFIX.$slug);
        if (! $draft) {
            $query->whereNotNull('published_version_id');
        }

        return $query->value('title');
    }

    /**
     * The next instant the published content of these documents changes on its own.
     *
     * @param  list<string>  $keys
     * @param  bool  $withSchedule  include the store's content schedule (banners, catalog, …)
     */
    private function nextChange(array $keys, bool $withSchedule = true): ?CarbonImmutable
    {
        $times = $withSchedule ? [$this->schedule->nextChange()] : [];
        $documents = BuilderDocument::query()->builder()->with('publishedVersion')->whereIn('key', $keys)->whereNotNull('published_version_id')->get();
        foreach ($documents as $document) {
            $content = $document->publishedVersion?->content;
            if ($content !== null) {
                $times[] = BuilderPageRenderer::nextScheduleChange($content);
                $times[] = $this->elementData->nextChange($content);
            }
        }
        $times = array_filter($times);
        usort($times, fn (CarbonImmutable $a, CarbonImmutable $b) => $a <=> $b);

        return $times[0] ?? null;
    }
}
