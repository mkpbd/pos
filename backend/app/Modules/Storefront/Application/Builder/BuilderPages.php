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
 */
class BuilderPages
{
    public function __construct(
        private readonly BuilderPageRenderer $renderer,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
        private readonly ContentSchedule $schedule,
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
            fn () => $this->nextChange($key),
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
     * @param  'published'|'draft'  $source
     * @return array<string, mixed>|null
     */
    public function render(string $key, string $source): ?array
    {
        $document = BuilderDocument::query()->with('publishedVersion')->where('key', $key)->first();
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

    private function nextChange(string $key): ?CarbonImmutable
    {
        $content = BuilderDocument::query()->with('publishedVersion')->where('key', $key)->first()?->publishedVersion?->content;
        $times = array_filter([
            $this->schedule->nextChange(),
            $content === null ? null : BuilderPageRenderer::nextScheduleChange($content),
        ]);
        usort($times, fn (CarbonImmutable $a, CarbonImmutable $b) => $a <=> $b);

        return $times[0] ?? null;
    }
}
