<?php

namespace App\Modules\Storefront\Application\Builder\Wizard;

use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Application\Builder\Templates\TemplateReferences;
use App\Modules\Storefront\Application\Festivals\StoreFestivals;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\Templates\PortableTemplate;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardMotion;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardOptions;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardRecipes;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * B21: "Build my page in 1 minute" (POST /storefront/builder/wizard). From a page type and a
 * goal the recipe (WizardRecipes) names sections of the built-in templates; they are
 * instantiated here like applying a template (photos imported once, references resolved, fresh
 * ids), then filled with the store's facts: its name, the chosen categories and products (else
 * its best sellers, else its newest live products), the running flash sale and coupon (a sale's
 * sections that show them are left out when nothing runs), the festival pack's own texts and
 * countdown (festival pages), the store's contact details (contact pages), its real published
 * reviews (a review wall, left out while there are none — never sample testimonials), and the built-in
 * English / Bangla texts (WizardCopy) — optionally rewritten by AI from store facts only
 * (WizardAiWriter). The look applies a B18 motion theme (WizardMotion). The result is validated
 * like any draft (PrepareBuilderContent) and saved as a **draft** only: the empty home page's
 * draft (a store whose builder home has no content and was never published) or a new landing
 * page. Nothing is published. Template links to content pages the store lacks are dropped (the
 * page check finds no broken links). The AI call runs outside any transaction (its usage row
 * always stays); the document and its audit row (`storefront.builder_wizard`, counts only) are
 * written in one transaction.
 *
 * @phpstan-type Target array{key: string, section: int, role: string, path: list<string|int>, translation: string, max: int, en: string, bn: string, link: ?string, link_path: ?list<string>}
 */
class BuildPageWizard
{
    /** Where a text role goes: element types, prop path, translation key, limit. */
    private const ROLES = [
        'heading' => ['types' => ['heading'], 'path' => ['text'], 'translation' => 'text', 'max' => 200],
        'text' => ['types' => ['text'], 'path' => ['html'], 'translation' => 'html', 'max' => 600],
        'button' => ['types' => ['button'], 'path' => ['label'], 'translation' => 'label', 'max' => 60, 'link' => 'button_link', 'link_path' => ['link']],
        'cta_title' => ['types' => ['cta'], 'path' => ['title'], 'translation' => 'title', 'max' => 120],
        'cta_text' => ['types' => ['cta'], 'path' => ['text'], 'translation' => 'text', 'max' => 400],
        'cta_button' => ['types' => ['cta'], 'path' => ['primary', 'label'], 'translation' => 'primary.label', 'max' => 60, 'link' => 'cta_link', 'link_path' => ['primary', 'link']],
        'title' => ['types' => '@titled', 'path' => ['title'], 'translation' => 'title', 'max' => 120],
        'subtitle' => ['types' => '@wrapped', 'path' => ['subtitle'], 'translation' => 'subtitle', 'max' => 255],
        'element_text' => ['types' => ['order_form', 'discount', 'form'], 'path' => ['text'], 'translation' => 'text', 'max' => 400],
    ];

    /** Elements (besides wrapped homepage sections) whose `title` the wizard writes. */
    private const TITLED = ['order_form', 'discount', 'form', 'review_wall'];

    /** The review wall: the store's newest real reviews of 4 stars and more, with the average. */
    private const REVIEW_WALL = ['source' => 'latest', 'product_id' => null, 'min_rating' => 4, 'limit' => 6, 'show_summary' => true];

    public function __construct(
        private readonly BuilderTemplateLibrary $library,
        private readonly ManageBuilderDocuments $documents,
        private readonly StorefrontCatalog $catalog,
        private readonly PromotionShowcase $promotions,
        private readonly StorefrontConfig $storefront,
        private readonly StoreFestivals $festivals,
        private readonly WizardCopy $copy,
        private readonly WizardAiWriter $ai,
        private readonly AuditTrail $audit,
        private readonly TenantContext $tenant,
        private readonly PageDirectory $pages,
        private readonly ReviewShowcase $reviews,
    ) {}

    /** @var array<string, bool> content page slug => whether it is on the store */
    private array $contentPages = [];

    /**
     * @param  array{page_type: string, title: string, slug?: ?string, goal: string, look: string, language: string, use_ai?: bool, category_ids?: list<string>, product_ids?: list<string>, festival?: ?string}  $input  validated
     * @return array{document: BuilderDocument, target: string, sections: list<array{template: string, label: string, label_bn: string}>, products: array{source: string, count: int}, festival: ?array{key: string, name: string, name_bn: string}, ai: array{used: bool, status: string}}
     */
    public function __invoke(array $input, ?string $userId): array
    {
        $pageType = $input['page_type'];
        $goal = $input['goal'];
        $title = trim($input['title']);
        $language = $input['language'];

        $categories = $this->chosenCategories($input['category_ids'] ?? []);
        $chosen = $this->chosenProducts($input['product_ids'] ?? []);
        $festival = $pageType === 'festival' ? $this->festival($input['festival'] ?? null) : null;

        $slots = WizardRecipes::slots($pageType, $goal, [
            'categories' => $categories !== [] || $this->catalog->categoryStrip(null, 4) !== [],
            'flash_sale' => in_array(true, array_column($this->promotions->liveAutomatic(20), 'flash_sale'), true),
            'coupon' => $this->promotions->runningCouponPromotion() !== null,
            'reviews' => $this->hasReviews(),
        ]);
        $products = WizardRecipes::needsProducts($slots) ? $this->productSource($chosen, $categories) : ['source' => 'none', 'cards' => [], 'category' => null];

        [$target, $home, $slug] = $this->target($pageType, $title, $input['slug'] ?? null);
        // The product a page about one product shows (spotlight, order form): the first chosen
        // one, else the first of the products shown (category, best sellers, newest).
        $landingProduct = $chosen[0]['id'] ?? $products['cards'][0]['id'] ?? null;
        $landingSlug = $landingProduct === null ? null : ($this->catalog->productSummaries([$landingProduct])[$landingProduct]['slug'] ?? null);
        $productUrl = $landingSlug === null ? null : '/product/'.$landingSlug;
        $facts = [
            'store' => trim((string) $this->storefront->settings()->site_name) ?: 'our shop',
            'title' => $title,
            'category' => $products['category'] !== null ? $categories[$products['category']]['name'] : (array_values($categories)[0]['name'] ?? null),
        ];

        /** @var TemplateReferences $references */
        $references = app(TemplateReferences::class);
        $references->useLandingProduct($landingProduct);
        $newId = $this->idGenerator();

        $sections = [];
        $made = [];
        $targets = [];
        foreach ($slots as $slot) {
            $templateId = WizardRecipes::template($slot, $festival['key'] ?? null);
            $portable = $this->library->sections($templateId, 'page')[WizardRecipes::SLOTS[$slot]['section']] ?? null;
            if (! is_array($portable)) {
                continue;
            }
            $portable = $this->portable($slot, $portable, $festival);
            foreach (PortableTemplate::concrete([$portable], $references, $newId) as $section) {
                $section = $this->fillCatalog($slot, $section, $products, $chosen, $categories);
                $section = $this->withWorkingLinks($section);
                if (! self::hasElements($section)) {
                    continue;
                }
                $source = in_array($slot, ['products', 'products_carousel'], true) ? $products['source'] : null;
                foreach ($this->targets($section, $pageType, $slot, $source, $facts, count($sections)) as $t) {
                    $targets[] = $t;
                }
                $sections[] = $section;
                $made[] = ['template' => $templateId, 'label' => WizardRecipes::SLOTS[$slot]['label'], 'label_bn' => WizardRecipes::SLOTS[$slot]['label_bn']];
            }
        }

        $ai = ['used' => false, 'status' => 'not_requested'];
        if (($input['use_ai'] ?? false) === true) {
            $written = $this->ai->rewrite((string) $this->tenant->requireOrganization(), $userId, $language, array_map(fn (array $t) => [
                'key' => $t['key'], 'role' => $t['role'], 'max' => $t['max'], 'en' => $t['en'], 'bn' => $t['bn'],
            ], $targets), [
                'store' => $facts['store'],
                'title' => $title,
                'page_type' => $pageType,
                'goal' => $goal,
                'categories' => array_values(array_column($categories, 'name')),
                'products' => array_values(array_slice(array_filter(array_column($chosen !== [] ? $chosen : $products['cards'], 'name'), 'is_string'), 0, WizardOptions::MAX_PRODUCTS)),
            ]);
            foreach ($targets as $i => $t) {
                $targets[$i]['en'] = $written['texts'][$t['key']]['en'] ?? $t['en'];
                $targets[$i]['bn'] = $written['texts'][$t['key']]['bn'] ?? $t['bn'];
            }
            $ai = ['used' => $written['status'] === 'ok', 'status' => $written['status']];
        }

        $sections = $this->writeTexts($sections, $targets, $language, $productUrl);
        $content = WizardMotion::apply(['schema_version' => BuilderDocumentSchema::SCHEMA_VERSION, 'sections' => $sections], $input['look']);

        // The AI call runs outside any transaction (its usage row must stay); the page and its
        // audit row are written together.
        $productCount = $products['source'] === 'chosen' ? count($chosen) : count($products['cards']);
        $document = DB::transaction(function () use ($target, $home, $title, $slug, $content, $pageType, $goal, $input, $language, $made, $categories, $products, $productCount, $ai) {
            if ($target === 'home') {
                $document = $home !== null
                    ? $this->documents->saveDraft($home, $home->draft_revision, $content)
                    : $this->documents->create(['kind' => BuilderDocument::KIND_PAGE, 'key' => BuilderDocument::HOME, 'title' => $title, 'from' => 'wizard'], $content);
            } else {
                $document = $this->documents->create(['kind' => BuilderDocument::KIND_PAGE, 'key' => BuilderDocument::LANDING_PREFIX.$slug, 'title' => $title, 'from' => 'wizard'], $content);
            }

            $this->audit->record('storefront.builder_wizard', $document, [], [], [
                'page_type' => $pageType,
                'goal' => $goal,
                'look' => $input['look'],
                'language' => $language,
                'target' => $target,
                'sections' => count($made),
                'categories' => count($categories),
                'products' => $productCount,
                'product_source' => $products['source'],
                'ai' => $ai['status'],
            ]);

            return $document;
        });

        return [
            'document' => $document,
            'target' => $target,
            'sections' => $made,
            'products' => ['source' => $products['source'], 'count' => $productCount],
            'festival' => $festival === null ? null : ['key' => $festival['key'], 'name' => $festival['name'], 'name_bn' => $festival['name_bn']],
            'ai' => $ai,
        ];
    }

    /**
     * Whether the review wall has something to show: approved reviews of 4 stars or more of
     * products on sale online (the same read the review wall's renderer makes).
     */
    private function hasReviews(): bool
    {
        $live = $this->catalog->liveProductIds();

        return $live !== [] && $this->reviews->approved($live, self::REVIEW_WALL['min_rating'], 'latest', 1, 20) !== [];
    }

    /**
     * The chosen categories (visible ones of the organization), in the given order.
     *
     * @param  list<string>  $ids
     * @return array<string, array{slug: string, name: string}>
     */
    private function chosenCategories(array $ids): array
    {
        $ids = array_values(array_unique(array_map('strtolower', $ids)));
        if ($ids === []) {
            return [];
        }
        $visible = $this->catalog->visibleCategories($ids);
        $missing = array_values(array_diff($ids, array_keys($visible)));
        if ($missing !== []) {
            throw ValidationException::withMessages(['category_ids' => 'Some chosen categories are not in your online store. Choose them again.']);
        }

        return array_combine($ids, array_map(fn (string $id) => $visible[$id], $ids));
    }

    /**
     * The chosen products (live ones of the organization) as cards, in the given order.
     *
     * @param  list<string>  $ids
     * @return list<array<string, mixed>>
     */
    private function chosenProducts(array $ids): array
    {
        $ids = array_values(array_unique(array_map('strtolower', $ids)));
        if ($ids === []) {
            return [];
        }
        $cards = $this->catalog->productCards($ids);
        if (count($cards) !== count($ids)) {
            throw ValidationException::withMessages(['product_ids' => 'Some chosen products are not on sale in your online store. Choose them again.']);
        }

        return $cards;
    }

    /**
     * Where the products come from: the chosen ones, the first chosen category that has live
     * products, the best sellers, else the newest; none at all is NOTHING_TO_SHOW.
     *
     * @param  list<array<string, mixed>>  $chosen
     * @param  array<string, array{slug: string, name: string}>  $categories
     * @return array{source: string, cards: list<array<string, mixed>>, category: ?string}
     */
    private function productSource(array $chosen, array $categories): array
    {
        if ($chosen !== []) {
            return ['source' => 'chosen', 'cards' => $chosen, 'category' => null];
        }
        foreach (array_keys($categories) as $categoryId) {
            $cards = $this->catalog->sourceProductCards('category', $categoryId, WizardOptions::MAX_PRODUCTS);
            if ($cards !== []) {
                return ['source' => 'category', 'cards' => $cards, 'category' => $categoryId];
            }
        }
        foreach (['best_sellers', 'new_arrivals'] as $source) {
            $cards = $this->catalog->sourceProductCards($source, null, WizardOptions::MAX_PRODUCTS);
            if ($cards !== []) {
                return ['source' => $source, 'cards' => $cards, 'category' => null];
            }
        }

        throw new BusinessRuleViolation('NOTHING_TO_SHOW', 'This page shows your products, but your online store has no products on sale yet. Put some products online first (Online store → Products), or choose a page that does not need products, such as "About us" with "Tell my story".', ['reason' => 'no_live_products']);
    }

    /**
     * The festival of a festival page: the chosen occasion, else the next one; with the end of
     * its suggested campaign window (the countdown's end).
     *
     * @return array{key: string, name: string, name_bn: string, ends_at: string}
     */
    private function festival(?string $key): array
    {
        $timezone = $this->festivals->timezone();
        $today = CarbonImmutable::now()->setTimezone($timezone);
        $key ??= $this->festivals->list()[0]['key'] ?? 'winter-sale';
        $next = FestivalCalendar::next($key, $today);
        $endsAt = $next === null
            ? $today->addDays(7)->endOfDay()->startOfSecond()
            : FestivalCalendar::suggestedWindow($key, $next, $today, $timezone)['ends_at'];

        return [
            'key' => $key,
            'name' => FestivalCalendar::OCCASIONS[$key]['name'],
            'name_bn' => FestivalCalendar::OCCASIONS[$key]['name_bn'],
            'ends_at' => $endsAt->toIso8601String(),
        ];
    }

    /**
     * Where the page goes: `[home|landing, the empty home document or null, the landing slug]`.
     * A home page goes into the builder home while it has no content (no sections, never
     * published); otherwise — and for every other page type — a new landing page. A chosen
     * address that is taken is 409 DOCUMENT_EXISTS; a made-up one gets -2, -3… instead.
     *
     * @return array{0: string, 1: ?BuilderDocument, 2: ?string}
     */
    private function target(string $pageType, string $title, ?string $slug): array
    {
        if ($pageType === 'home') {
            $home = BuilderDocument::query()->where('key', BuilderDocument::HOME)->first();
            if ($home === null) {
                return ['home', null, null];
            }
            if (($home->draft['sections'] ?? []) === [] && $home->published_version_id === null) {
                return ['home', $home, null];
            }
        }

        if ($slug !== null) {
            if (BuilderDocument::query()->where('key', BuilderDocument::LANDING_PREFIX.$slug)->exists()) {
                throw new BusinessRuleViolation('DOCUMENT_EXISTS', 'Another page already uses the address /p/'.$slug.'. Choose another address.', ['key' => BuilderDocument::LANDING_PREFIX.$slug], 409);
            }

            return ['landing', null, $slug];
        }

        // Latin titles only: a Bangla title transliterated would be a puzzling address.
        $base = preg_match('/[^\x00-\x7F]/', $title) === 1 ? '' : rtrim(substr(trim(Str::slug($title), '-'), 0, 50), '-');
        if (strlen($base) < 2 || $base === 'home') {
            $base = str_replace('_', '-', $pageType).'-page';
        }
        $taken = BuilderDocument::query()->where('key', 'like', BuilderDocument::LANDING_PREFIX.$base.'%')->pluck('key')->flip();
        $candidate = $base;
        for ($n = 2; isset($taken[BuilderDocument::LANDING_PREFIX.$candidate]); $n++) {
            $candidate = $base.'-'.$n;
        }

        return ['landing', null, $candidate];
    }

    /**
     * Slot-specific changes to a template section before its references are resolved: the
     * festival hero's countdown ends with the campaign window; the contact section shows the
     * store's own contact details (and its map only when the store has an address).
     *
     * @param  array<string, mixed>  $portable
     * @param  array{ends_at: string}|null  $festival
     * @return array<string, mixed>
     */
    private function portable(string $slot, array $portable, ?array $festival): array
    {
        if ($slot === 'hero_festival' && $festival !== null) {
            return self::rewrite($portable, function (array $node) use ($festival) {
                if (($node['type'] ?? null) === 'countdown' && is_array($node['props'] ?? null) && ($node['props']['source'] ?? 'date') === 'date') {
                    $node['props']['ends_at'] = $festival['ends_at'];
                    $node['props']['promotion_id'] = null;
                }

                return $node;
            });
        }
        if ($slot === 'visit') {
            $address = $this->storefront->shopperFacts()['contact']['address'];
            $columns = [];
            foreach ($portable['columns'] ?? [] as $column) {
                $elements = [];
                foreach ($column['elements'] ?? [] as $element) {
                    if (($element['type'] ?? null) === 'icon_list') {
                        $elements[] = ['id' => 'e_contact', 'type' => 'contact_block', 'props' => ElementRegistry::defaults('contact_block')];
                    } elseif (($element['type'] ?? null) === 'map') {
                        if ($address !== null) {
                            $element['props']['query'] = mb_substr($address, 0, 200);
                            $elements[] = $element;
                        }
                    } else {
                        $elements[] = $element;
                    }
                }
                if ($elements !== []) {
                    $columns[] = ['elements' => $elements] + $column;
                }
            }
            if (count($columns) === 1) {
                $columns[0]['width'] = ['base' => 100];
            }
            $portable['columns'] = $columns;
        }

        return $portable;
    }

    /**
     * Product and category sections show the chosen records (or the store's best sellers / newest).
     *
     * @param  array<string, mixed>  $section
     * @param  array{source: string, cards: list<array<string, mixed>>, category: ?string}  $products
     * @param  list<array<string, mixed>>  $chosen
     * @param  array<string, array{slug: string, name: string}>  $categories
     * @return array<string, mixed>
     */
    private function fillCatalog(string $slot, array $section, array $products, array $chosen, array $categories): array
    {
        return self::rewrite($section, function (array $node) use ($slot, $products, $chosen, $categories) {
            $type = $node['type'] ?? null;
            if (in_array($type, ['product_grid', 'product_carousel'], true) && in_array($slot, ['products', 'products_carousel'], true)) {
                $config = $node['props']['config'] ?? [];
                $config['category_id'] = null;
                $node['props']['items'] = [];
                if ($products['source'] === 'chosen') {
                    $config['source'] = 'manual';
                    $node['props']['items'] = array_map(fn (array $card) => ['item_type' => 'product', 'item_id' => $card['id']], $chosen);
                } elseif ($products['source'] === 'category') {
                    $config['source'] = 'category';
                    // A second chosen category (with products) fills the carousel of a collection.
                    $config['category_id'] = $products['category'];
                    if ($slot === 'products_carousel') {
                        foreach (array_keys($categories) as $id) {
                            if ($id !== $products['category'] && $this->catalog->sourceProductCards('category', $id, 1) !== []) {
                                $config['category_id'] = $id;
                                break;
                            }
                        }
                    }
                } elseif (in_array($products['source'], ['best_sellers', 'new_arrivals'], true)) {
                    $config['source'] = $products['source'];
                }
                $node['props']['config'] = $config;
            }
            if ($type === 'review_wall' && $slot === 'reviews') {
                $node['props'] = self::REVIEW_WALL + $node['props'];
            }
            if ($type === 'category_strip' && $categories !== []) {
                $node['props']['config']['source'] = 'manual';
                $node['props']['items'] = array_map(fn (string $id) => ['item_type' => 'category', 'item_id' => $id], array_keys($categories));
            }

            return $node;
        });
    }

    /**
     * Links of the templates to content pages the store does not have (e.g. /pages/contact)
     * never stay: such a button goes, a call to action loses its second button (its first one
     * goes to the shop), any other such link is removed.
     *
     * @param  array<string, mixed>  $section
     * @return array<string, mixed>
     */
    private function withWorkingLinks(array $section): array
    {
        $section['columns'] = $this->linksInColumns($section['columns'] ?? []);

        return $section;
    }

    /**
     * @param  list<array<string, mixed>>  $columns
     * @return list<array<string, mixed>>
     */
    private function linksInColumns(array $columns): array
    {
        foreach ($columns as $c => $column) {
            $elements = [];
            foreach ($column['elements'] ?? [] as $element) {
                $type = $element['type'] ?? null;
                if ($type === 'button' && $this->brokenLink($element['props']['link']['url'] ?? null)) {
                    continue;
                }
                if ($type === 'cta') {
                    if ($this->brokenLink($element['props']['secondary']['link']['url'] ?? null)) {
                        $element['props']['secondary'] = null;
                    }
                    if ($this->brokenLink($element['props']['primary']['link']['url'] ?? null)) {
                        $element['props']['primary']['link'] = ['url' => '/shop'];
                    }
                }
                $element['props'] = $this->unlink(is_array($element['props'] ?? null) ? $element['props'] : []);
                if ($type === 'inner_row') {
                    $element['columns'] = $this->linksInColumns($element['columns'] ?? []);
                }
                $elements[] = $element;
            }
            $columns[$c]['elements'] = $elements;
        }

        return $columns;
    }

    /**
     * @param  array<string|int, mixed>  $value
     * @return array<string|int, mixed>
     */
    private function unlink(array $value): array
    {
        foreach ($value as $key => $item) {
            if (! is_array($item)) {
                continue;
            }
            $value[$key] = $key === 'link' && $this->brokenLink($item['url'] ?? null) ? null : $this->unlink($item);
        }

        return $value;
    }

    private function brokenLink(mixed $url): bool
    {
        if (! is_string($url) || preg_match('#^/pages/([^/?\#]+)/?(?:[?\#].*)?$#', $url, $match) !== 1) {
            return false;
        }
        $slug = rawurldecode($match[1]);

        return ! ($this->contentPages[$slug] ??= $this->pages->visibleBySlug($slug) !== null);
    }

    /**
     * The texts the wizard writes in a section: for each copy field, the first element that
     * plays its role, with the built-in English and Bangla text.
     *
     * @param  array<string, mixed>  $section
     * @param  array{store: string, title: string, category: ?string}  $facts
     * @return list<Target>
     */
    private function targets(array $section, string $pageType, string $slot, ?string $source, array $facts, int $index): array
    {
        $texts = $this->copy->texts($pageType, $slot, $source, $facts);
        $result = [];
        foreach (self::ROLES as $role => $spec) {
            if (! isset($texts[$role])) {
                continue;
            }
            $path = self::find($section, function (array $node) use ($spec) {
                $type = (string) ($node['type'] ?? '');

                return match ($spec['types']) {
                    '@titled' => ElementRegistry::sectionType($type) !== null || in_array($type, self::TITLED, true),
                    '@wrapped' => ElementRegistry::sectionType($type) !== null,
                    default => in_array($type, $spec['types'], true),
                };
            });
            if ($path === null) {
                continue;
            }
            $link = isset($spec['link']) ? ($texts[$spec['link']]['en'] ?? null) : null;
            $result[] = [
                'key' => 's'.($index + 1).'_'.$role,
                'section' => $index,
                'role' => $role,
                'path' => $path,
                'translation' => $spec['translation'],
                'max' => $spec['max'],
                'en' => WizardAiWriter::plain($texts[$role]['en'], $spec['max']),
                'bn' => WizardAiWriter::plain($texts[$role]['bn'], $spec['max']),
                'link' => $link,
                'link_path' => $spec['link_path'] ?? null,
            ];
        }

        return $result;
    }

    /**
     * Writes the texts into the sections for the language: `en` English only (every Bangla
     * translation dropped), `both` English with Bangla translations, `bn` Bangla as the base
     * texts (the templates' own Bangla translations moved into the base texts).
     *
     * @param  list<array<string, mixed>>  $sections
     * @param  list<Target>  $targets
     * @return list<array<string, mixed>>
     */
    private function writeTexts(array $sections, array $targets, string $language, ?string $productUrl): array
    {
        foreach ($targets as $t) {
            $index = $t['section'];
            $node = self::get($sections[$index], $t['path']);
            $base = $language === 'bn' ? $t['bn'] : $t['en'];
            $node['props'] = self::set($node['props'] ?? [], self::propPath($t), $t['role'] === 'text' ? '<p>'.htmlspecialchars($base, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'</p>' : $base);
            unset($node['translations']['bn'][$t['translation']]);
            if ($language === 'both') {
                $node['translations']['bn'][$t['translation']] = $t['role'] === 'text' ? '<p>'.htmlspecialchars($t['bn'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8').'</p>' : $t['bn'];
            }
            if ($t['link'] !== null && $t['link_path'] !== null) {
                // `@product`: the page of the product the page is about (else the shop).
                $link = $t['link'] === '@product' ? ($productUrl ?? '/shop') : $t['link'];
                $node['props'] = self::set($node['props'], $t['link_path'], ['url' => $link]);
            }
            if (($node['translations']['bn'] ?? null) === []) {
                unset($node['translations']['bn']);
            }
            $sections[$index] = self::put($sections[$index], $t['path'], $node);
        }

        if ($language === 'both') {
            return $sections;
        }

        return self::rewrite($sections, function (array $node) use ($language) {
            if (! isset($node['translations']) || ! is_array($node['translations'])) {
                return $node;
            }
            $bn = is_array($node['translations']['bn'] ?? null) ? $node['translations']['bn'] : [];
            if ($language === 'bn') {
                foreach ($bn as $key => $text) {
                    if (is_string($text) && self::promote($node, (string) $key, $text)) {
                        unset($bn[$key]);
                    }
                }
            }
            // English only: the Bangla goes; Bangla: what could not move into the base text stays.
            $bn = $language === 'en' ? [] : $bn;
            if ($bn === []) {
                unset($node['translations']['bn']);
            } else {
                $node['translations']['bn'] = $bn;
            }

            return $node;
        });
    }

    /**
     * Moves a Bangla translation into the element's base text (false when the key names
     * nothing the wizard can find in the props).
     *
     * @param  array<string, mixed>  $node
     */
    private static function promote(array &$node, string $key, string $text): bool
    {
        $type = (string) ($node['type'] ?? '');
        $props = is_array($node['props'] ?? null) ? $node['props'] : [];
        if (ElementRegistry::sectionType($type) !== null) {
            if (in_array($key, ['title', 'subtitle'], true)) {
                $node['props'][$key] = $text;

                return true;
            }
            if (! str_contains($key, '.') && array_key_exists($key, $props['config'] ?? [])) {
                $node['props']['config'][$key] = $text;

                return true;
            }

            return false;
        }
        $path = ElementRegistry::translationTarget($type, $key, $props);
        if ($path === null) {
            return false;
        }
        $value = $props;
        foreach (array_slice($path, 0, -1) as $segment) {
            if (! is_array($value) || ! array_key_exists($segment, $value)) {
                return false;
            }
            $value = $value[$segment];
        }
        if (! is_array($value) || ! array_key_exists(end($path), $value)) {
            return false;
        }
        $node['props'] = self::set($props, $path, $text);

        return true;
    }

    /**
     * @param  Target  $target
     * @return list<string>
     */
    private static function propPath(array $target): array
    {
        return self::ROLES[$target['role']]['path'];
    }

    /**
     * The path (inside the section) of the first element matching, in reading order.
     *
     * @param  array<string, mixed>  $section
     * @param  callable(array<string, mixed>): bool  $match
     * @return list<string|int>|null
     */
    private static function find(array $section, callable $match, array $prefix = []): ?array
    {
        foreach ($section['columns'] ?? [] as $c => $column) {
            foreach ($column['elements'] ?? [] as $e => $element) {
                $path = [...$prefix, 'columns', $c, 'elements', $e];
                if ($match($element)) {
                    return $path;
                }
                if (($element['type'] ?? null) === 'inner_row' && ($inner = self::find($element, $match, $path)) !== null) {
                    return $inner;
                }
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $value
     * @param  list<string|int>  $path
     * @return array<string, mixed>
     */
    private static function get(array $value, array $path): array
    {
        foreach ($path as $segment) {
            $value = $value[$segment];
        }

        return $value;
    }

    /**
     * @param  array<string|int, mixed>  $value
     * @param  list<string|int>  $path
     * @return array<string|int, mixed>
     */
    private static function put(array $value, array $path, mixed $new): array
    {
        if ($path === []) {
            return $new;
        }
        $segment = array_shift($path);
        $value[$segment] = self::put(is_array($value[$segment] ?? null) ? $value[$segment] : [], $path, $new);

        return $value;
    }

    /**
     * @param  array<string|int, mixed>  $value
     * @param  list<string|int>  $path
     * @return array<string|int, mixed>
     */
    private static function set(array $value, array $path, mixed $new): array
    {
        $segment = array_shift($path);
        if ($path === []) {
            $value[$segment] = $new;

            return $value;
        }
        $value[$segment] = self::set(is_array($value[$segment] ?? null) ? $value[$segment] : [], $path, $new);

        return $value;
    }

    /**
     * @param  array<string, mixed>  $section
     */
    private static function hasElements(array $section): bool
    {
        foreach ($section['columns'] ?? [] as $column) {
            if (($column['elements'] ?? []) !== []) {
                return true;
            }
        }

        return false;
    }

    /**
     * Applies `$change` to every node (object with a `type`) inside the value.
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
            if (is_array($child) && $k !== 'props') {
                $value[$k] = self::rewrite($child, $change);
            }
        }

        return $value;
    }

    /**
     * Fresh node ids (`s_`, `c_`, `e_` + 10 random characters), unique within one page.
     *
     * @return callable(string): string
     */
    private function idGenerator(): callable
    {
        $used = [];

        return function (string $prefix) use (&$used): string {
            do {
                $id = $prefix.'_'.Str::lower(Str::random(10));
            } while (isset($used[$id]));
            $used[$id] = true;

            return $id;
        };
    }
}
