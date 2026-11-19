<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Orders\Application\Contracts\OrderPreviews;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Carbon\CarbonImmutable;

/**
 * B14: the page context a store page template is designed with in the editor — the same shape
 * the storefront builds in the browser (frontend `storefront/builder/templates/types.ts`
 * StorePageContext) — and the store API answers its main part draws (the canvas fetches
 * nothing): the first listing page (GET /store/products), the blog post (GET /store/blog/{slug})
 * or a masked order (Orders OrderPreviews; or a made-up one). Organization from the tenant.
 *
 * `$id`: category / brand / post — id or slug; search — the words; order — id, number or
 * `sample`. Without one: the category / brand with the most live products, the first word of
 * the newest product's name, the newest post, the newest order (else the made-up one). An
 * unknown id is 404 NOT_FOUND; nothing to show at all leaves that part null.
 */
class BuilderSampleContext
{
    public const LISTING_PER_PAGE = 24;

    public const RECENT_ORDERS = 10;

    public const SAMPLE_ORDER = 'sample';

    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly OrderPreviews $orders,
        private readonly StorefrontConfig $config,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @return array{context: array<string, mixed>, sample: array<string, mixed>|null, choices: list<array{id: string, label: string}>|null}
     */
    public function build(string $template, ?string $id): array
    {
        $id = $id === null || trim($id) === '' ? null : trim($id);
        $context = ['template' => $template, 'store' => $this->store()];
        $sample = null;
        $choices = null;

        switch ($template) {
            case 'shop':
                $sample = ['listing' => $this->catalog->listing(['per_page' => self::LISTING_PER_PAGE])];
                break;
            case 'category':
            case 'brand':
                $page = $this->catalog->pageSample($template, $id);
                if ($page === null && $id !== null) {
                    throw new BusinessRuleViolation('NOT_FOUND', $template === 'category' ? 'This category is not on the store.' : 'This brand is not on the store.', [], 404);
                }
                $context[$template] = $page;
                if ($page !== null) {
                    $sample = ['listing' => $this->catalog->listing($template === 'category'
                        ? ['category' => $page['slug'], 'per_page' => self::LISTING_PER_PAGE]
                        : ['brand' => [$page['slug']], 'per_page' => self::LISTING_PER_PAGE])];
                }
                break;
            case 'search':
                $query = $id === null ? $this->sampleWord() : mb_substr($id, 0, 100);
                $listing = $this->catalog->listing(['q' => $query, 'per_page' => self::LISTING_PER_PAGE]);
                $context['search'] = ['query' => $query, 'result_count' => $listing['meta']['total']];
                $sample = ['listing' => $listing];
                break;
            case 'blog_post':
                $post = $this->blog->postSample($id);
                if ($post === null && $id !== null) {
                    throw new BusinessRuleViolation('NOT_FOUND', 'This blog post is not on the store.', [], 404);
                }
                $context['post'] = $post === null ? null : [
                    'id' => $post['id'],
                    'slug' => $post['slug'],
                    'title' => $post['title'],
                    'excerpt' => $post['excerpt'] ?? null,
                    'author' => $post['author'] ?? null,
                    'published_at' => $post['published_at'] ?? null,
                    'reading_time' => $post['reading_minutes'] ?? null,
                    'category' => $post['category']['name'] ?? null,
                ];
                if ($post !== null) {
                    unset($post['id']);
                    $sample = ['post' => $post];
                }
                break;
            case 'order':
                $view = $id === self::SAMPLE_ORDER ? null : $this->orders->masked($id);
                if ($view === null && $id !== null && $id !== self::SAMPLE_ORDER) {
                    throw new BusinessRuleViolation('NOT_FOUND', 'This order does not exist.', [], 404);
                }
                $view ??= $this->madeUpOrder();
                $context['order'] = self::orderContext($view);
                $sample = ['order' => $view];
                $choices = [
                    ['id' => self::SAMPLE_ORDER, 'label' => 'Sample order'],
                    ...array_map(fn (array $o) => ['id' => $o['number'], 'label' => $o['number'].' · '.CarbonImmutable::parse($o['placed_at'])->format('Y-m-d')], $this->orders->recent(self::RECENT_ORDERS)),
                ];
                break;
        }

        return ['context' => $context, 'sample' => $sample, 'choices' => $choices];
    }

    /**
     * The store's name and contact details as the storefront has them (bootstrap `store.name`
     * and the live theme's footer contact).
     *
     * @return array{name: string, phone: ?string, email: ?string, address: ?string}
     */
    private function store(): array
    {
        $contact = $this->config->theme()->settings['footer']['contact'] ?? [];
        $text = fn (mixed $v) => is_string($v) && trim($v) !== '' ? $v : null;

        return [
            'name' => (string) $this->config->settings()->site_name,
            'phone' => $text($contact['phone'] ?? null),
            'email' => $text($contact['email'] ?? null),
            'address' => $text($contact['address'] ?? null),
        ];
    }

    /**
     * The first word (2+ characters) of the newest live product's name, else "".
     */
    private function sampleWord(): string
    {
        $card = $this->catalog->listing(['sort' => 'latest', 'per_page' => 12])['data'][0] ?? null;
        foreach (preg_split('/\s+/u', trim((string) ($card['name'] ?? ''))) ?: [] as $word) {
            if (mb_strlen($word) >= 2) {
                return $word;
            }
        }

        return '';
    }

    /**
     * @return array<string, mixed>
     */
    private function madeUpOrder(): array
    {
        $cards = array_slice($this->catalog->listing(['sort' => 'featured', 'per_page' => 12])['data'], 0, 2);
        $organization = $this->organizations->summary($this->tenant->requireOrganization());

        return $this->orders->sample(
            array_map(fn (array $card) => [
                'name' => (string) $card['name'],
                'price' => (string) $card['price'],
                'image_url' => $card['image']['url'] ?? null,
                'product_url' => $card['url'] ?? null,
            ], $cards),
            (string) ($organization['base_currency'] ?? 'BDT'),
            ($organization['tax_mode'] ?? 'exclusive') === 'inclusive',
        );
    }

    /**
     * The page context's `order` of an order view.
     *
     * @param  array<string, mixed>  $view
     * @return array<string, mixed>
     */
    private static function orderContext(array $view): array
    {
        $min = $view['eta_min_days'] ?? null;
        $max = $view['eta_max_days'] ?? null;
        $name = trim((string) ($view['contact']['name'] ?? ''));

        return [
            'number' => $view['number'],
            'status' => $view['status_label'],
            'total' => $view['total'],
            'currency' => $view['currency'] ?? null,
            'placed_at' => $view['placed_at'],
            'customer_first_name' => $name === '' ? null : preg_split('/\s+/u', $name)[0],
            'payment_method' => $view['payment_method_label'],
            'delivery_eta' => $min === null && $max === null ? null : ['min_days' => $min, 'max_days' => $max],
            'sample' => (bool) ($view['sample'] ?? false),
        ];
    }
}
