<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;

/**
 * B10: the server half of "Check page" before publishing — what only the server knows. The
 * editor checks the rest (alt texts, headings, contrast …) and merges both lists.
 *
 * Each issue is `{code, severity (error | warning | tip), node_id|null, message, details: {path,
 * field, …}}` (`field` = the path inside the node). Checked:
 * - records the page refers to that are gone (the save check's codes — the next save would fail);
 * - global sections that are missing, don't fit, or were never published (they don't show live);
 * - products not on sale online, hidden categories / brands, banners off or outside their dates,
 *   switched-off menus; an order form whose product is not on sale is an error;
 * - links to the store (site paths, or absolute URLs on the store's own domains) whose product,
 *   category, brand, content page, landing page, blog post or blog category doesn't exist or isn't
 *   live, and site paths that are no storefront page;
 * - forms that notify nobody (no e-mail and no staff with forms.view) — a tip.
 *
 * Hidden nodes (and what they contain) are left out, except for records that are gone. Nothing is
 * saved. Errors don't block publishing: the owner decides.
 */
class BuilderPageCheck
{
    public const SEVERITIES = ['error', 'warning', 'tip'];

    /** First path segments of storefront pages that need no lookup. */
    private const STATIC_ROUTES = ['shop', 'search', 'cart', 'wishlist', 'checkout', 'account', 'order', 'newsletter', 'demos', 'storage', 'sitemap.xml', 'robots.txt'];

    private const LINK_MESSAGES = [
        'product' => 'This link goes to a product that doesn\'t exist or isn\'t on sale online.',
        'category' => 'This link goes to a category that doesn\'t exist or isn\'t shown in the shop.',
        'brand' => 'This link goes to a brand that doesn\'t exist or isn\'t shown in the shop.',
        'page' => 'This link goes to a content page that doesn\'t exist or isn\'t published.',
        'landing' => 'This link goes to a campaign page that doesn\'t exist or isn\'t published.',
        'blog_post' => 'This link goes to a blog post that doesn\'t exist or isn\'t published.',
        'blog_category' => 'This link goes to a blog category that doesn\'t exist.',
    ];

    /** @var array<string, array<string, mixed>|null> url => link problem */
    private array $links = [];

    /** @var list<string>|null */
    private ?array $hosts = null;

    /** @var array{category: array<string, true>, brand: array<string, true>}|null */
    private ?array $listings = null;

    private ?bool $formsSeen = null;

    public function __construct(
        private readonly PrepareBuilderContent $prepare,
        private readonly BuilderReferences $references,
        private readonly StorefrontCatalog $catalog,
        private readonly PageDirectory $pages,
        private readonly BlogDirectory $blog,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array<string, mixed>|null  $content  unsaved content (normalized with the draft-save
     *                                              rules; malformed: InvalidBuilderDocument), null = the saved draft
     * @return array{issues: list<array<string, mixed>>, counts: array{error: int, warning: int, tip: int}, checked_at: string}
     *
     * @throws InvalidBuilderDocument
     */
    public function check(BuilderDocument $document, ?array $content = null): array
    {
        $this->links = [];
        $this->hosts = null;
        $this->listings = null;
        $this->formsSeen = null;
        $context = $document->contentContext();
        $tree = $content === null ? $document->draft : $this->prepare->sanitized($content, $context, $document->isGlobal());

        /** @var array<string, array{path: string, node: array<string, mixed>, order: int, hidden: bool}> $nodes */
        $nodes = [];
        $hiddenPaths = [];
        BuilderDocumentSchema::walk($tree, function (array $node, string $path) use (&$nodes, &$hiddenPaths) {
            $hidden = ($node['hidden'] ?? false) === true;
            foreach ($hiddenPaths as $hiddenPath) {
                $hidden = $hidden || str_starts_with($path, $hiddenPath.'.');
            }
            if (($node['hidden'] ?? false) === true) {
                $hiddenPaths[] = $path;
            }
            if (is_string($node['id'] ?? null)) {
                $nodes[$node['id']] = ['path' => $path, 'node' => $node, 'order' => count($nodes), 'hidden' => $hidden];
            }
        });

        $issues = [];
        $issue = function (string $code, string $severity, ?string $nodeId, string $message, string $path, array $details = []) use (&$issues, $nodes) {
            $nodePath = $nodeId !== null ? ($nodes[$nodeId]['path'] ?? null) : null;
            $field = $nodePath !== null && str_starts_with($path, $nodePath.'.') ? substr($path, strlen($nodePath) + 1) : $path;
            $issues[] = [
                'code' => $code,
                'severity' => $severity,
                'node_id' => $nodeId,
                'message' => $message,
                'details' => ['path' => $path, 'field' => $field] + $details,
                '_order' => $nodeId !== null ? ($nodes[$nodeId]['order'] ?? PHP_INT_MAX) : -1,
            ];
        };
        $shown = fn (?string $nodeId) => $nodeId === null || ! ($nodes[$nodeId]['hidden'] ?? false);

        ['uses' => $uses, 'globals' => $globals] = $this->references->collect($tree);
        $this->checkReferences($uses, $nodes, $issue, $shown);
        $this->checkGlobals($globals, $context, $issue);

        foreach ($nodes as $id => $entry) {
            if ($entry['hidden']) {
                continue;
            }
            $props = is_array($entry['node']['props'] ?? null) ? $entry['node']['props'] : [];
            foreach ($this->urls($props, $entry['path'].'.props') as $path => $url) {
                $problem = $this->link($url);
                if ($problem !== null) {
                    $issue($problem['code'], $problem['code'] === 'LINK_BROKEN' ? 'error' : 'warning', $id, $problem['message'], $path, $problem['details']);
                }
            }
            if (($entry['node']['type'] ?? null) === 'form' && trim((string) ($props['notify_email'] ?? '')) === '' && ! $this->formsAreSeen()) {
                $issue('FORM_NO_RECIPIENT', 'tip', $id, 'Nobody will hear about messages sent with this form. Add an e-mail address to notify, or give a staff member permission to view form submissions.', $entry['path'].'.props.notify_email');
            }
        }

        $rank = array_flip(self::SEVERITIES);
        usort($issues, fn (array $a, array $b) => [$rank[$a['severity']], $a['_order']] <=> [$rank[$b['severity']], $b['_order']]);
        $counts = ['error' => 0, 'warning' => 0, 'tip' => 0];
        foreach ($issues as $i => $entry) {
            $counts[$entry['severity']]++;
            unset($issues[$i]['_order']);
        }

        return ['issues' => array_values($issues), 'counts' => $counts, 'checked_at' => CarbonImmutable::now()->toIso8601String()];
    }

    /**
     * Records that are gone (errors), then those that exist but don't show (warnings).
     *
     * @param  array<string, list<array{path: string, node_id: ?string, ids: list<string>}>>  $uses
     * @param  array<string, array{path: string, node: array<string, mixed>, order: int, hidden: bool}>  $nodes
     */
    private function checkReferences(array $uses, array $nodes, callable $issue, callable $shown): void
    {
        foreach ($uses as $code => $list) {
            $base = explode(':', $code)[0];
            $all = array_values(array_unique(array_merge(...array_column($list, 'ids'))));
            $found = $this->references->existing($code, $all);
            $unseen = $this->unseen($base, $found);

            foreach ($list as $entry) {
                $missing = array_values(array_diff($entry['ids'], $found));
                if ($missing !== []) {
                    $issue($base, 'error', $entry['node_id'], BuilderReferences::message($base), $entry['path'], ['ids' => $missing]);
                }
                if (! $shown($entry['node_id'])) {
                    continue;
                }
                $notShown = array_values(array_intersect($entry['ids'], array_keys($unseen)));
                if ($notShown === []) {
                    continue;
                }
                $node = $entry['node_id'] !== null ? ($nodes[$entry['node_id']]['node'] ?? null) : null;
                if ($base === 'PRODUCT_NOT_FOUND' && ($node['type'] ?? null) === 'order_form') {
                    // P2a: the product the order form sells (an error), then its add-on (a warning).
                    $sold = $node['props']['product_id'] ?? null;
                    if (in_array($sold, $notShown, true)) {
                        $issue('ORDER_FORM_PRODUCT_NOT_ON_SALE', 'error', $entry['node_id'], 'The product of this order form isn\'t on sale online, so nobody can order it.', $entry['path'], ['ids' => [$sold]]);
                    }
                    $notShown = array_values(array_diff($notShown, [$sold]));
                    if ($notShown !== []) {
                        $issue('PRODUCT_NOT_LIVE', 'warning', $entry['node_id'], self::unseenMessage('PRODUCT_NOT_LIVE'), substr($entry['path'], 0, -strlen('product_id')).'upsell.product_id', ['ids' => $notShown]);
                    }

                    continue;
                }
                $unseenCode = (string) $unseen[$notShown[0]];
                $details = ['ids' => $notShown];
                if ($unseenCode === 'BANNER_NOT_LIVE') {
                    $details['states'] = $this->bannerStates($notShown);
                }
                $issue($unseenCode, 'warning', $entry['node_id'], self::unseenMessage($unseenCode), $entry['path'], $details);
            }
        }
    }

    /**
     * Of the existing ids, those that don't show on the store, with their issue code.
     *
     * @param  list<string>  $ids
     * @return array<string, string> id => code
     */
    private function unseen(string $code, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $hidden = match ($code) {
            'PRODUCT_NOT_FOUND' => array_keys(array_filter($this->catalog->productSummaries($ids), fn (array $p) => $p['slug'] === null)),
            'CATEGORY_NOT_FOUND' => array_values(array_diff($ids, array_keys($this->catalog->visibleCategories($ids)))),
            'BRAND_NOT_FOUND' => array_values(array_diff($ids, array_keys($this->catalog->visibleBrands($ids)))),
            'BANNER_NOT_FOUND' => array_keys($this->bannerStates($ids, true)),
            'MENU_NOT_FOUND' => Menu::query()->whereIn('id', $ids)->where('is_active', false)->pluck('id')->all(),
            default => [],
        };
        $unseenCode = match ($code) {
            'PRODUCT_NOT_FOUND' => 'PRODUCT_NOT_LIVE',
            'CATEGORY_NOT_FOUND' => 'CATEGORY_HIDDEN',
            'BRAND_NOT_FOUND' => 'BRAND_HIDDEN',
            'BANNER_NOT_FOUND' => 'BANNER_NOT_LIVE',
            default => 'MENU_INACTIVE',
        };

        return array_fill_keys($hidden, $unseenCode);
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, string> id => inactive | scheduled | ended (`$onlyUnseen`: live ones left out)
     */
    private function bannerStates(array $ids, bool $onlyUnseen = true): array
    {
        $states = [];
        foreach (Banner::query()->whereIn('id', $ids)->get() as $banner) {
            $state = $banner->state();
            if (! $onlyUnseen || $state !== 'live') {
                $states[$banner->id] = $state;
            }
        }

        return $states;
    }

    private static function unseenMessage(string $code): string
    {
        return match ($code) {
            'PRODUCT_NOT_LIVE' => 'This product isn\'t on sale online, so shoppers won\'t see it here.',
            'CATEGORY_HIDDEN' => 'This category isn\'t shown in the shop, so it won\'t appear here.',
            'BRAND_HIDDEN' => 'This brand isn\'t shown in the shop, so it won\'t appear here.',
            'BANNER_NOT_LIVE' => 'This banner is switched off or outside its dates, so it won\'t show.',
            default => 'This menu is switched off, so it won\'t show.',
        };
    }

    /**
     * Global sections: missing / wrong place (the save check), and never published (the live page
     * leaves them out).
     *
     * @param  list<array{path: string, node_id: string, ref: string}>  $globals
     */
    private function checkGlobals(array $globals, string $context, callable $issue): void
    {
        if ($globals === []) {
            return;
        }
        $failed = [];
        foreach ($this->references->globalErrors($globals, $context) as $error) {
            $issue($error['code'], 'error', $error['node_id'], $error['message'], $error['path'], ['ids' => $error['ids']]);
            $failed[$error['node_id']] = true;
        }
        $documents = BuilderDocument::query()->where('kind', BuilderDocument::KIND_GLOBAL)
            ->whereIn('id', array_values(array_unique(array_column($globals, 'ref'))))
            ->get(['id', 'title', 'published_version_id'])->keyBy('id');
        foreach ($globals as $global) {
            $document = $documents->get($global['ref']);
            if (! isset($failed[$global['node_id']]) && $document !== null && $document->published_version_id === null) {
                $issue('GLOBAL_UNPUBLISHED', 'error', $global['node_id'], 'This global section isn\'t published yet, so it won\'t show on the live page. Publish the global section first.', $global['path'], [
                    'global_id' => $document->id,
                    'title' => $document->title,
                ]);
            }
        }
    }

    /**
     * Every `url` string inside a node's props (links, buttons, list items …), keyed by path.
     *
     * @param  array<array-key, mixed>  $value
     * @return array<string, string>
     */
    private function urls(array $value, string $path): array
    {
        $urls = [];
        foreach ($value as $key => $item) {
            if ($key === 'url' && is_string($item)) {
                $urls["{$path}.url"] = $item;
            } elseif (is_array($item)) {
                $urls += $this->urls($item, "{$path}.{$key}");
            }
        }

        return $urls;
    }

    /**
     * The problem with a link to the store, or null (fine, or not a link to this store).
     *
     * @return array{code: string, message: string, details: array<string, mixed>}|null
     */
    private function link(string $url): ?array
    {
        if (array_key_exists($url, $this->links)) {
            return $this->links[$url];
        }

        return $this->links[$url] = $this->linkProblem($url);
    }

    /**
     * @return array{code: string, message: string, details: array<string, mixed>}|null
     */
    private function linkProblem(string $url): ?array
    {
        if (str_starts_with($url, '/')) {
            if (str_starts_with($url, '//')) {
                return null;
            }
            $path = (string) parse_url('http://store.invalid'.$url, PHP_URL_PATH);
        } else {
            $host = parse_url($url, PHP_URL_HOST);
            if (! is_string($host) || ! in_array(strtolower($host), $this->hosts(), true)) {
                return null;
            }
            $path = (string) (parse_url($url, PHP_URL_PATH) ?? '/');
        }
        $segments = array_values(array_filter(array_map('rawurldecode', explode('/', trim($path, '/'))), fn (string $s) => $s !== ''));
        if ($segments === [] || in_array(strtolower($segments[0]), self::STATIC_ROUTES, true)) {
            return null;
        }

        $first = strtolower($segments[0]);
        $slug = $segments[1] ?? null;
        $count = count($segments);
        $target = match (true) {
            $first === 'blog' && $count === 1 => 'ok',
            $first === 'blog' && $count === 3 && strtolower((string) $slug) === 'category' => $this->blog->categoryMeta($segments[2]) === null ? 'blog_category' : 'ok',
            $first === 'blog' && $count === 2 => $this->blog->postMeta((string) $slug) === null ? 'blog_post' : 'ok',
            $count !== 2 => null,
            $first === 'product' => $this->catalog->liveProductId((string) $slug) === null ? 'product' : 'ok',
            $first === 'category', $first === 'brand' => isset($this->listings()[$first][strtolower((string) $slug)]) ? 'ok' : $first,
            $first === 'pages' => $this->pages->visibleBySlug((string) $slug) === null ? 'page' : 'ok',
            $first === 'p' => $this->landingIsLive(strtolower((string) $slug)) ? 'ok' : 'landing',
            default => null,
        };

        return match ($target) {
            'ok' => null,
            null => ['code' => 'LINK_UNKNOWN', 'message' => 'This link goes to an address that isn\'t a page of your shop.', 'details' => ['url' => $url]],
            default => ['code' => 'LINK_BROKEN', 'message' => self::LINK_MESSAGES[$target], 'details' => ['url' => $url, 'target' => $target]],
        };
    }

    private function landingIsLive(string $slug): bool
    {
        return BuilderDocument::query()->where('kind', BuilderDocument::KIND_PAGE)
            ->where('key', BuilderDocument::LANDING_PREFIX.$slug)->whereNotNull('published_version_id')->exists();
    }

    /**
     * Slugs of the visible categories and brands (lower-case).
     *
     * @return array{category: array<string, true>, brand: array<string, true>}
     */
    private function listings(): array
    {
        if ($this->listings === null) {
            $targets = $this->catalog->linkTargets();
            $slugs = fn (array $rows, string $prefix) => array_fill_keys(array_map(
                fn (string $url) => strtolower(rawurldecode(substr($url, strlen($prefix)))),
                array_values(array_filter(array_column($rows, 'url'), fn ($url) => is_string($url) && str_starts_with($url, $prefix))),
            ), true);
            $this->listings = ['category' => $slugs($targets['categories'], '/category/'), 'brand' => $slugs($targets['brands'], '/brand/')];
        }

        return $this->listings;
    }

    /**
     * The store's own host names (absolute links to them are links to the store).
     *
     * @return list<string>
     */
    private function hosts(): array
    {
        return $this->hosts ??= StorefrontDomain::query()->pluck('host')->map(fn (string $host) => strtolower($host))->all();
    }

    private function formsAreSeen(): bool
    {
        return $this->formsSeen ??= $this->users->withPermission($this->tenant->requireOrganization(), 'forms.view')->isNotEmpty();
    }
}
