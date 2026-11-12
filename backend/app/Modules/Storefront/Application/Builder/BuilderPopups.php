<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\Builder\PopupSettings;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;

/**
 * B8b: popups and bars as the storefront reads them (`GET /store/builder/popups`): the live ones
 * — published, switched on and inside the published version's schedule — each as `{id, version,
 * settings, payload: {sections, media, data}}` in the request's language, in display preference
 * order (priority high → low, then the oldest first). Cached per content version and language
 * until the next schedule or data change (a popup starting or ending, a countdown, a promotion).
 * The staff preview of one popup's draft is never cached.
 */
class BuilderPopups
{
    /** Settings the storefront does not need (the server already applied the schedule). */
    private const ADMIN_ONLY = ['starts_at', 'ends_at', 'translations'];

    public function __construct(
        private readonly BuilderPageRenderer $renderer,
        private readonly BuilderElementData $elementData,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * @return array{popups: list<array<string, mixed>>, never_on: list<string>}
     */
    public function live(): array
    {
        $popups = $this->version->remember(
            $this->tenant->requireOrganization(),
            'builder:popups',
            fn () => $this->build(),
            fn () => $this->nextChange(),
        );

        return ['popups' => $popups, 'never_on' => PopupSettings::NEVER_ON];
    }

    /**
     * The draft of one popup for a staff preview (whatever its switch, schedule, trigger or
     * frequency); `popups` is empty for an unknown id.
     *
     * @return array{popups: list<array<string, mixed>>, never_on: list<string>}
     */
    public function draft(string $id): array
    {
        $document = preg_match('/^[0-9a-f-]{36}$/', strtolower($id)) === 1
            ? BuilderDocument::query()->where('kind', BuilderDocument::KIND_POPUP)->whereKey(strtolower($id))->first()
            : null;

        return [
            'popups' => $document === null ? [] : [$this->entry($document, $document->draft, null, 'draft')],
            'never_on' => PopupSettings::NEVER_ON,
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function build(): array
    {
        $now = CarbonImmutable::now();
        $result = [];
        foreach ($this->candidates() as $document) {
            $version = $document->publishedVersion;
            if ($version === null || ! self::inSchedule($version->content['popup'] ?? [], $now)) {
                continue;
            }
            $entry = $this->entry($document, $version->content, $version->number, 'published');
            // A popup whose content all dropped out (hidden, out of schedule, no data) shows nothing.
            if ($entry['payload']['sections'] !== []) {
                $result[] = $entry;
            }
        }

        return $result;
    }

    /**
     * Published, switched-on popups in display order.
     *
     * @return iterable<BuilderDocument>
     */
    private function candidates(): iterable
    {
        return BuilderDocument::query()->with('publishedVersion')
            ->where('kind', BuilderDocument::KIND_POPUP)->where('active', true)->whereNotNull('published_version_id')
            ->orderBy('created_at')->orderBy('id')->get()
            ->sortBy([
                fn (BuilderDocument $a, BuilderDocument $b) => ($b->publishedVersion->content['popup']['priority'] ?? 0) <=> ($a->publishedVersion->content['popup']['priority'] ?? 0),
            ])->values();
    }

    /**
     * @param  array<string, mixed>  $content
     * @param  'published'|'draft'  $source
     * @return array<string, mixed>
     */
    private function entry(BuilderDocument $document, array $content, ?int $number, string $source): array
    {
        $rendered = $this->renderer->render($document, $content, $number, $source);
        // Stored settings are already valid; normalizing again restores the key order jsonb loses.
        $settings = PopupSettings::normalize($content['popup'] ?? null, fn () => null);
        $label = $settings['translations'][$this->locale->current()]['label'] ?? null;
        $settings['label'] = is_string($label) && trim($label) !== '' ? $label : ($settings['label'] ?? '');

        return [
            'id' => $document->id,
            'version' => $number,
            'settings' => array_diff_key($settings, array_flip(self::ADMIN_ONLY)),
            'payload' => [
                'sections' => $rendered['sections'],
                'media' => $rendered['media'],
                'data' => $rendered['data'],
            ],
        ];
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    public static function inSchedule(array $settings, CarbonImmutable $now): bool
    {
        $starts = $settings['starts_at'] ?? null;
        $ends = $settings['ends_at'] ?? null;

        return ! (is_string($starts) && CarbonImmutable::parse($starts)->gt($now))
            && ! (is_string($ends) && CarbonImmutable::parse($ends)->lte($now));
    }

    /**
     * The next instant the live popups change on their own: a popup's schedule, or a node /
     * data change inside a popup that is live.
     */
    private function nextChange(): ?CarbonImmutable
    {
        $now = CarbonImmutable::now();
        $times = [];
        foreach ($this->candidates() as $document) {
            $content = $document->publishedVersion?->content;
            if ($content === null) {
                continue;
            }
            foreach (['starts_at', 'ends_at'] as $key) {
                $at = $content['popup'][$key] ?? null;
                if (is_string($at) && ($instant = CarbonImmutable::parse($at))->gt($now)) {
                    $times[] = $instant;
                }
            }
            if (self::inSchedule($content['popup'] ?? [], $now)) {
                $times[] = BuilderPageRenderer::nextScheduleChange($content);
                $times[] = $this->elementData->nextChange($content);
            }
        }
        $times = array_filter($times);
        usort($times, fn (CarbonImmutable $a, CarbonImmutable $b) => $a <=> $b);

        return $times[0] ?? null;
    }
}
