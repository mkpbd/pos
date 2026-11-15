<?php

namespace App\Modules\Storefront\Application\Festivals;

use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\PrepareBuilderContent;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Application\Builder\Templates\TemplateReferences;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\FestivalSetup;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * B17: one-click festival setup (POST /storefront/festivals/{key}/setup) — makes the drafts of
 * an occasion's campaign from the built-in festival templates (`festival-<key>-landing | hero |
 * bar`), never publishing anything:
 *
 * - landing: a campaign page `landing:<slug>` (default slug `<key>-<year>`);
 * - home_hero: the hero template's sections at the top of the home draft, each with the node
 *   schedule `{starts_at, ends_at}` (a store without a builder home first gets one imported from
 *   its current homepage, so publishing it keeps the rest of the home page);
 * - bar: a popup (the template's bar) with its schedule `starts_at / ends_at`, switched on so it
 *   shows once published (live = published + on + within its schedule).
 *
 * Every countdown (source date) in them counts down to the window's end; with `discount_id`
 * every discount element shows that promotion (else the template's "running coupon" one).
 *
 * Idempotent per organization, occasion and year (`storefront_festival_setups`): a repeat
 * setup rewrites the same landing page and popup drafts and replaces the home sections it added
 * before — parts not included are left as they are; the landing page keeps its first address.
 * One transaction under a per-occasion lock; audited (`storefront.festival_setup`).
 */
class SetupFestival
{
    public function __construct(
        private readonly ManageBuilderDocuments $documents,
        private readonly PrepareBuilderContent $prepare,
        private readonly BuilderTemplateLibrary $library,
        private readonly PromotionShowcase $promotions,
        private readonly AuditTrail $audit,
        private readonly TenantContext $tenant,
        private readonly StoreFestivals $festivals,
    ) {}

    /**
     * @param  array{year: int, starts_at: string, ends_at: string, include: array{landing?: bool, home_hero?: bool, bar?: bool}, discount_id?: ?string, landing_slug?: ?string}  $input  validated
     * @return array{festival: array<string, mixed>, documents: list<array<string, mixed>>, publish_ids: list<string>}
     */
    public function __invoke(string $key, array $input): array
    {
        $year = $input['year'];
        if (FestivalCalendar::occurrence($key, $year) === null) {
            throw new BusinessRuleViolation('FESTIVAL_DATE_UNKNOWN', 'We do not know the date of this occasion in '.$year.' yet. Choose another year.', ['key' => $key, 'year' => $year]);
        }
        $timezone = $this->festivals->timezone();
        $startsAt = CarbonImmutable::parse($input['starts_at'])->setTimezone($timezone);
        $endsAt = CarbonImmutable::parse($input['ends_at'])->setTimezone($timezone);
        $this->checkWindow($startsAt, $endsAt);
        $discountId = isset($input['discount_id']) ? strtolower($input['discount_id']) : null;
        if ($discountId !== null) {
            $promotion = $this->promotions->discounts([$discountId])[$discountId] ?? null;
            if ($promotion === null || $promotion['state'] === 'expired') {
                throw ValidationException::withMessages(['discount_id' => 'Choose a discount of your store that has not ended.']);
            }
        }
        $include = [
            'landing' => (bool) ($input['include']['landing'] ?? false),
            'home_hero' => (bool) ($input['include']['home_hero'] ?? false),
            'bar' => (bool) ($input['include']['bar'] ?? false),
        ];
        $window = ['starts_at' => $startsAt->toIso8601String(), 'ends_at' => $endsAt->toIso8601String()];
        $name = FestivalCalendar::OCCASIONS[$key]['name'].' '.$year;

        DB::transaction(function () use ($key, $year, $include, $window, $discountId, $name, $input, $startsAt, $endsAt) {
            if (DB::getDriverName() === 'pgsql') {
                DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ['festival-setup:'.$this->tenant->requireOrganization().':'.$key.':'.$year]);
            }
            $setup = FestivalSetup::query()->where('occasion', $key)->where('year', $year)->lockForUpdate()->first()
                ?? new FestivalSetup(['occasion' => $key, 'year' => $year]);
            $before = $setup->exists ? $setup->only(['starts_at', 'ends_at', 'landing_document_id', 'popup_document_id', 'home_section_ids', 'discount_id']) : [];

            if ($include['landing']) {
                $setup->landing_document_id = $this->landing($key, $year, $setup, $window, $discountId, $name, $input['landing_slug'] ?? null)->id;
            }
            if ($include['home_hero']) {
                $setup->home_section_ids = $this->homeHero($key, $setup, $window, $discountId);
            }
            if ($include['bar']) {
                $setup->popup_document_id = $this->bar($key, $setup, $window, $discountId, $name)->id;
            }
            // Stored in UTC (the connection writes the wall time without the offset).
            $setup->starts_at = $startsAt->utc();
            $setup->ends_at = $endsAt->utc();
            $setup->discount_id = $discountId;
            $setup->save();

            $this->audit->record('storefront.festival_setup', $setup, $before, [
                'occasion' => $key,
                'year' => $year,
                'starts_at' => $window['starts_at'],
                'ends_at' => $window['ends_at'],
                'include' => $include,
                'discount_id' => $discountId,
                'landing_document_id' => $setup->landing_document_id,
                'popup_document_id' => $setup->popup_document_id,
                'home_section_ids' => $setup->home_section_ids,
            ]);
        });

        $setup = FestivalSetup::query()->where('occasion', $key)->where('year', $year)->firstOrFail();
        $documents = $this->festivals->documents($setup);

        return [
            'festival' => $this->festivals->find($key, $year),
            'documents' => $documents,
            'publish_ids' => array_values(array_map(fn (array $d) => $d['id'], array_filter($documents, fn (array $d) => $d['status'] !== 'published'))),
        ];
    }

    /**
     * The window ends after it starts, at most 60 days later, and in the future.
     */
    private function checkWindow(CarbonImmutable $startsAt, CarbonImmutable $endsAt): void
    {
        if ($endsAt->lte($startsAt)) {
            throw ValidationException::withMessages(['ends_at' => 'The end must be after the start.']);
        }
        if ($endsAt->gt($startsAt->addDays(FestivalCalendar::MAX_WINDOW_DAYS))) {
            throw ValidationException::withMessages(['ends_at' => 'A festival campaign can run for at most '.FestivalCalendar::MAX_WINDOW_DAYS.' days.']);
        }
        if ($endsAt->lte(CarbonImmutable::now())) {
            throw ValidationException::withMessages(['ends_at' => 'The end must be in the future.']);
        }
    }

    /**
     * @param  array{starts_at: string, ends_at: string}  $window
     */
    private function landing(string $key, int $year, FestivalSetup $setup, array $window, ?string $discountId, string $name, ?string $slug): BuilderDocument
    {
        $content = [
            'schema_version' => BuilderDocumentSchema::SCHEMA_VERSION,
            'sections' => $this->sections("festival-{$key}-landing", 'page', $window, $discountId),
        ];
        $existing = $setup->landing_document_id === null ? null : BuilderDocument::query()->find($setup->landing_document_id);
        if ($existing !== null) {
            // Keep the page's SEO settings the owner may have added.
            if (isset($existing->draft['seo'])) {
                $content['seo'] = $existing->draft['seo'];
            }

            return $this->documents->saveDraft($existing, $existing->draft_revision, $content);
        }

        $slug ??= "{$key}-{$year}";
        $documentKey = BuilderDocument::LANDING_PREFIX.$slug;
        if (BuilderDocument::query()->where('key', $documentKey)->exists()) {
            throw new BusinessRuleViolation('SLUG_TAKEN', 'Another page already uses the address /p/'.$slug.'. Choose another address.', ['landing_slug' => $slug]);
        }

        return $this->documents->create(['kind' => BuilderDocument::KIND_PAGE, 'key' => $documentKey, 'title' => $name], $content);
    }

    /**
     * The hero sections at the top of the home draft (replacing this setup's earlier ones).
     *
     * @param  array{starts_at: string, ends_at: string}  $window
     * @return list<string> the inserted sections' ids
     */
    private function homeHero(string $key, FestivalSetup $setup, array $window, ?string $discountId): array
    {
        $sections = array_map(
            fn (array $section) => ['schedule' => $window] + $section,
            $this->sections("festival-{$key}-hero", 'page', $window, $discountId),
        );
        // Validated (and references checked) on their own first, so a problem names the template.
        $hero = ($this->prepare)(['schema_version' => BuilderDocumentSchema::SCHEMA_VERSION, 'sections' => $sections], 'page')['sections'];

        $home = BuilderDocument::query()->where('key', BuilderDocument::HOME)->first()
            ?? $this->documents->create(['kind' => BuilderDocument::KIND_PAGE, 'key' => BuilderDocument::HOME, 'title' => 'Home', 'from' => 'homepage']);
        $home = BuilderDocument::query()->whereKey($home->id)->lockForUpdate()->firstOrFail();
        $previous = array_flip($setup->home_section_ids ?? []);
        $kept = array_values(array_filter($home->draft['sections'] ?? [], fn (array $section) => ! isset($previous[$section['id'] ?? ''])));
        if (count($kept) + count($hero) > BuilderDocumentSchema::MAX_SECTIONS) {
            throw new BusinessRuleViolation('HOME_FULL', 'The home page already has the most sections it can hold. Remove one before adding the festival banner.');
        }
        $this->documents->saveDraft($home, $home->draft_revision, ['sections' => [...$hero, ...$kept]] + $home->draft);

        return array_column($hero, 'id');
    }

    /**
     * @param  array{starts_at: string, ends_at: string}  $window
     */
    private function bar(string $key, FestivalSetup $setup, array $window, ?string $discountId, string $name): BuilderDocument
    {
        $templateId = "festival-{$key}-bar";
        $settings = $this->library->popupSettings($templateId);
        if ($settings === null) {
            throw $this->missingTemplate($templateId);
        }
        $content = [
            'schema_version' => BuilderDocumentSchema::SCHEMA_VERSION,
            'popup' => array_replace($settings, ['starts_at' => $window['starts_at'], 'ends_at' => $window['ends_at']]),
            'sections' => $this->sections($templateId, 'popup', $window, $discountId),
        ];

        $document = $setup->popup_document_id === null ? null : BuilderDocument::query()->find($setup->popup_document_id);
        $document ??= $this->documents->create(['kind' => BuilderDocument::KIND_POPUP, 'key' => '', 'title' => $name.' bar', 'template' => $templateId]);
        $document = $this->documents->saveDraft($document, $document->draft_revision, $content);
        if (! $document->active) {
            // On from the start: it shows once published, within its dates (never before).
            $document->active = true;
            $document->save();
        }

        return $document;
    }

    /**
     * A built-in festival template's sections for this store: the discount elements pointed at
     * the chosen promotion, references resolved, fresh ids, and every date countdown ending
     * with the window.
     *
     * @param  array{starts_at: string, ends_at: string}  $window
     * @return list<array<string, mixed>>
     */
    private function sections(string $templateId, string $context, array $window, ?string $discountId): array
    {
        $template = $this->library->find($templateId);
        if ($template === null || ! in_array($context, $template['allowed_in'] ?? [], true)) {
            throw $this->missingTemplate($templateId);
        }
        $portable = $this->library->sections($templateId, $context);
        if ($discountId !== null) {
            $portable = self::rewrite($portable, function (array $node) use ($discountId) {
                if (($node['type'] ?? null) === 'discount' && is_array($node['props'] ?? null)) {
                    unset($node['props']['promotion_ref']);
                    $node['props']['promotion_id'] = $discountId;
                }

                return $node;
            });
        }
        /** @var TemplateReferences $references */
        $references = app(TemplateReferences::class);
        $used = [];
        $sections = PortableTemplate::concrete($portable, $references, function (string $prefix) use (&$used): string {
            do {
                $id = $prefix.'_'.Str::lower(Str::random(10));
            } while (isset($used[$id]));
            $used[$id] = true;

            return $id;
        });

        return self::rewrite($sections, function (array $node) use ($window) {
            if (($node['type'] ?? null) === 'countdown' && is_array($node['props'] ?? null) && ($node['props']['source'] ?? 'date') === 'date') {
                $node['props']['source'] = 'date';
                $node['props']['ends_at'] = $window['ends_at'];
                $node['props']['promotion_id'] = null;
            }

            return $node;
        });
    }

    /**
     * Applies `$change` to every node (object with a `type`) inside the sections.
     *
     * @param  array<mixed>  $value
     * @param  callable(array<string, mixed>): array<string, mixed>  $change
     * @return array<mixed>
     */
    private static function rewrite(array $value, callable $change): array
    {
        if (is_string($value['type'] ?? null)) {
            $value = $change($value);
        }
        foreach ($value as $k => $child) {
            if (is_array($child)) {
                $value[$k] = self::rewrite($child, $change);
            }
        }

        return $value;
    }

    private function missingTemplate(string $templateId): BusinessRuleViolation
    {
        return new BusinessRuleViolation('FESTIVAL_TEMPLATE_MISSING', 'The built-in design for this occasion is missing. Please update the app.', ['template' => $templateId]);
    }
}
