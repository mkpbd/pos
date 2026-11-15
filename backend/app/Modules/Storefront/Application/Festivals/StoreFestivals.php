<?php

namespace App\Modules\Storefront\Application\Festivals;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\FestivalSetup;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * B17: the store's festival calendar (GET /storefront/festivals) — each occasion once, at its
 * next date within 12 months in the store's time zone, ordered by date, with the suggested
 * campaign window and what a one-click setup made for that year:
 *
 * `{key, name, name_bn, kind, sale_wording, next: {year, starts_on, ends_on, expected, note,
 * note_bn}, suggested: {starts_at, ends_at}, setup: null | {year, starts_at, ends_at, state,
 * landing_slug, documents: [{id, kind, key, title, role, status, preview_url}]}}`.
 *
 * A setup's `state`: `ended` once its window is over; `drafts_ready` while any of its documents
 * is unpublished or has unpublished changes; else `live_on_dates` (everything published — it
 * shows and hides by itself). A document's `status`: unpublished | changed | published (the
 * home page counts as published once its published version holds the festival sections).
 */
class StoreFestivals
{
    public function __construct(
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
        private readonly StorefrontConfig $storefront,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function list(): array
    {
        $timezone = $this->timezone();
        $now = CarbonImmutable::now();
        $today = $now->setTimezone($timezone);
        $setups = FestivalSetup::query()->get();

        $result = [];
        foreach (array_keys(FestivalCalendar::OCCASIONS) as $key) {
            $next = FestivalCalendar::next($key, $today);
            if ($next === null) {
                continue;
            }
            $setup = $setups->first(fn (FestivalSetup $s) => $s->occasion === $key && $s->year === $next['year']);
            $result[] = $this->item($key, $next, $setup, $today, $timezone, $now);
        }
        usort($result, fn (array $a, array $b) => [$a['next']['starts_on'], $a['key']] <=> [$b['next']['starts_on'], $b['key']]);

        return $result;
    }

    /**
     * One occasion as listed, for its occurrence in `$year` (after a setup).
     *
     * @return array<string, mixed>
     */
    public function find(string $key, int $year): array
    {
        $timezone = $this->timezone();
        $now = CarbonImmutable::now();
        $today = $now->setTimezone($timezone);
        $occurrence = FestivalCalendar::occurrence($key, $year) ?? FestivalCalendar::next($key, $today);
        $setup = FestivalSetup::query()->where('occasion', $key)->where('year', $year)->first();

        return $this->item($key, $occurrence, $setup, $today, $timezone, $now);
    }

    /**
     * The organization's time zone (store dates).
     */
    public function timezone(): string
    {
        return (string) ($this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? config('app.timezone'));
    }

    /**
     * The documents a setup made, as listed: `[{id, kind, key, title, role, status, preview_url}]`
     * (landing, home, bar — those that still exist).
     *
     * @return list<array<string, mixed>>
     */
    public function documents(FestivalSetup $setup): array
    {
        $ids = array_values(array_filter([$setup->landing_document_id, $setup->popup_document_id]));
        $documents = BuilderDocument::query()->with('publishedVersion')
            ->where(function ($query) use ($ids, $setup) {
                $query->whereIn('id', $ids);
                if ($setup->home_section_ids !== []) {
                    $query->orWhere('key', BuilderDocument::HOME);
                }
            })
            ->get();

        return $this->present($setup, $documents);
    }

    /**
     * @param  Collection<int, BuilderDocument>  $documents
     * @return list<array<string, mixed>>
     */
    private function present(FestivalSetup $setup, Collection $documents): array
    {
        $storeUrl = $this->storefront->primaryUrl();
        $result = [];
        foreach (['landing' => $setup->landing_document_id, 'home' => null, 'bar' => $setup->popup_document_id] as $role => $id) {
            $document = $role === 'home'
                ? ($setup->home_section_ids === [] ? null : $documents->first(fn (BuilderDocument $d) => $d->key === BuilderDocument::HOME))
                : ($id === null ? null : $documents->firstWhere('id', $id));
            if ($document === null) {
                continue;
            }
            $published = $document->publishedVersion;
            $changed = $published === null || self::canonical($published->content) !== self::canonical($document->draft);
            if ($role === 'home') {
                $live = $published === null ? [] : array_column($published->content['sections'] ?? [], 'id');
                $status = array_diff($setup->home_section_ids, $live) !== [] ? 'unpublished' : ($changed ? 'changed' : 'published');
            } else {
                $status = $published === null ? 'unpublished' : ($changed ? 'changed' : 'published');
            }
            $path = $document->isPopup() ? '/?preview=draft&popup='.$document->id : $document->storePath().'?preview=draft';
            $result[] = [
                'id' => $document->id,
                'kind' => $document->kind,
                'key' => $document->key,
                'title' => $document->title,
                'role' => $role,
                'status' => $status,
                'preview_url' => $storeUrl === null ? null : $storeUrl.$path,
            ];
        }

        return $result;
    }

    /**
     * Arrays with sorted keys (jsonb storage does not keep key order), for comparing contents.
     */
    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $value = array_map(fn ($v) => self::canonical($v), $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>|null  $next
     * @return array<string, mixed>
     */
    private function item(string $key, ?array $next, ?FestivalSetup $setup, CarbonImmutable $today, string $timezone, CarbonImmutable $now): array
    {
        $occasion = FestivalCalendar::OCCASIONS[$key];
        $suggested = $next === null ? null : FestivalCalendar::suggestedWindow($key, $next, $today, $timezone);
        $setupData = null;
        if ($setup !== null) {
            $documents = $this->documents($setup);
            $state = match (true) {
                $setup->ends_at->lte($now) => 'ended',
                $documents === [] || in_array(true, array_map(fn (array $d) => $d['status'] !== 'published', $documents), true) => 'drafts_ready',
                default => 'live_on_dates',
            };
            $landing = array_values(array_filter($documents, fn (array $d) => $d['role'] === 'landing'))[0] ?? null;
            $setupData = [
                'year' => $setup->year,
                'starts_at' => $setup->starts_at->setTimezone($timezone)->toIso8601String(),
                'ends_at' => $setup->ends_at->setTimezone($timezone)->toIso8601String(),
                'state' => $state,
                'landing_slug' => $landing === null ? null : substr($landing['key'], strlen(BuilderDocument::LANDING_PREFIX)),
                'documents' => $documents,
            ];
        }

        return [
            'key' => $key,
            'name' => $occasion['name'],
            'name_bn' => $occasion['name_bn'],
            'kind' => $occasion['kind'],
            'sale_wording' => $occasion['sale_wording'],
            'next' => $next,
            'suggested' => $suggested === null ? null : [
                'starts_at' => $suggested['starts_at']->toIso8601String(),
                'ends_at' => $suggested['ends_at']->toIso8601String(),
            ],
            'setup' => $setupData,
        ];
    }
}
