<?php

namespace Database\Seeders;

use App\Modules\Marketing\Application\Actions\FollowShortLink;
use App\Modules\Marketing\Application\Actions\ManageCampaigns;
use App\Modules\Marketing\Application\Actions\ManageShortLinks;
use App\Modules\Marketing\Application\Actions\RecordVisit;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Orders\Application\Actions\PlaceDirectOrder;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use RuntimeException;

/**
 * P2a: a Facebook campaign on each demo store — a one-product order page (`/p/order-now`,
 * from the "Single product order page" template, published), the campaign, a short link
 * (`/go/fb-order`, Facebook / social), a dozen visits and three cash-on-delivery orders placed
 * through the order form with the campaign's attribution. DemoThemesSeeder applies it to every
 * new demo store; run it on its own to upgrade demo stores created before P2a:
 *
 *   php artisan db:seed --class=DemoLandingSeeder
 *
 * Idempotent: a store that already has a campaign is skipped. Everything goes through the same
 * actions as the API; the order e-mails and staff notifications are left out. Development only.
 */
class DemoLandingSeeder extends Seeder
{
    public const SLUG = 'order-now';

    public const UTM_CAMPAIGN = 'facebook-order';

    public const CODE = 'fb-order';

    private const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

    /** Demo shoppers: name, phone, area. */
    private const SHOPPERS = [
        ['Nusrat Jahan', '01711000001', 'Mirpur'],
        ['Tanvir Hasan', '01811000002', 'Uttara'],
        ['Sadia Islam', '01911000003', 'Dhanmondi'],
    ];

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo store seeder must not run in production.');
        }

        foreach (DemoThemesSeeder::STORES as $key) {
            /** @var array<string, mixed> $data */
            $data = require DemoThemesSeeder::path("{$key}.php");
            $organizationId = StorefrontDomain::query()->withoutGlobalScopes()->where('host', $data['host'])->value('organization_id');
            if ($organizationId === null) {
                $this->command?->line("  {$data['name']}: not seeded yet, skipped.");

                continue;
            }

            app(TenantContext::class)->runAs($organizationId, function () use ($data) {
                if (Campaign::query()->exists()) {
                    $this->command?->line("  {$data['name']}: already has a campaign, skipped.");

                    return;
                }
                DB::transaction(fn () => self::apply($data));
                $this->command?->info("  {$data['name']}: campaign, order page /p/".self::SLUG.' and short link /go/'.self::CODE.' added.');
            });
        }
    }

    /**
     * Adds the store's P2a demo data (inside its tenant context, after its catalog, stock and checkout).
     *
     * @param  array<string, mixed>  $data  the store's data file
     */
    public static function apply(array $data): void
    {
        [$productId, $variantId] = self::product();

        $documents = app(ManageBuilderDocuments::class);
        $document = $documents->create([
            'kind' => 'page',
            'key' => 'landing:'.self::SLUG,
            'title' => 'Order now',
            'from' => 'template',
            'template' => 'landing-order',
            'product_id' => $productId,
        ]);
        $documents->publish($document, 'Demo order page');

        $campaign = app(ManageCampaigns::class)->create([
            'name' => 'Facebook order page',
            'slug' => 'facebook-order',
            'utm_campaign' => self::UTM_CAMPAIGN,
            'landing_document_id' => $document->id,
        ]);
        app(ManageShortLinks::class)->create([
            'code' => self::CODE,
            'target_path' => '/p/'.self::SLUG,
            'campaign_id' => $campaign->id,
            'utm' => ['source' => 'facebook', 'medium' => 'social'],
        ]);

        // A dozen visitors from the short link (documentation addresses, RFC 5737).
        $follow = app(FollowShortLink::class);
        $visit = app(RecordVisit::class);
        for ($n = 1; $n <= 12; $n++) {
            $follow(self::CODE, self::BROWSER);
            $visit(['path' => '/p/'.self::SLUG, 'code' => self::CODE, 'utm_source' => 'facebook', 'utm_medium' => 'social', 'utm_campaign' => self::UTM_CAMPAIGN],
                '192.0.2.'.$n, self::BROWSER);
        }

        // Three orders through the order form.
        $dhaka = (int) DB::table('geo_districts')->where('name_en', 'Dhaka')->value('id');
        $form = self::formElement($document->id);
        $place = app(PlaceDirectOrder::class);
        foreach (self::SHOPPERS as $i => [$name, $phone, $area]) {
            $body = [
                'document_id' => $document->id,
                'element_id' => $form,
                'lines' => [['variant_id' => $variantId, 'quantity' => 1]],
                'payment_method' => 'cod',
            ];
            $preview = $place->preview($body + ['address' => ['district_id' => $dhaka]], null);
            Event::fakeFor(fn () => $place->place($body + [
                'contact' => ['name' => $name, 'phone' => $phone],
                'address' => ['district_id' => $dhaka, 'area' => $area, 'address_line' => 'House '.(20 + $i).', Road '.(5 + $i)],
                'shipping_method_id' => $preview['shipping_method_id'],
                'note' => null,
                'expected_total' => $preview['total'],
                'attribution' => [
                    'utm_source' => 'facebook', 'utm_medium' => 'social', 'utm_campaign' => self::UTM_CAMPAIGN,
                    'short_link' => self::CODE, 'landing_path' => '/p/'.self::SLUG, 'referrer_host' => 'm.facebook.com',
                ],
            ], null, ['ip' => null, 'user_agent' => 'Demo seeder', 'site_url' => 'http://'.$data['host']]), [OrderPlaced::class]);
        }
    }

    /**
     * The product the order page sells: the first featured (else newest) product on sale whose
     * first variant has at least five in stock (or is not stock-tracked).
     *
     * @return array{0: string, 1: string} product id, variant id
     */
    private static function product(): array
    {
        $catalog = app(StorefrontCatalog::class);
        foreach (['featured', 'new_arrivals'] as $source) {
            foreach ($catalog->sourceProductCards($source, null, 20) as $card) {
                $variantId = DB::table('product_variants')->where('product_id', $card['id'])->where('is_active', true)->orderBy('created_at')->orderBy('id')->value('id');
                $variant = $variantId === null ? null : ($catalog->variantsForCart([(string) $variantId])[(string) $variantId] ?? null);
                if ($variant !== null && $variant['purchasable'] && $variant['in_stock'] && ! $variant['allow_decimal']
                    && ($variant['max_quantity'] === null || (float) $variant['max_quantity'] >= 5)) {
                    return [(string) $card['id'], (string) $variantId];
                }
            }
        }

        throw new RuntimeException('The demo store has no product in stock for its order page.');
    }

    /**
     * The id of the order form on the published page.
     */
    private static function formElement(string $documentId): string
    {
        $content = json_decode((string) DB::table('builder_versions')
            ->join('builder_documents', 'builder_documents.published_version_id', '=', 'builder_versions.id')
            ->where('builder_documents.id', $documentId)->value('builder_versions.content'), true);
        $found = null;
        foreach ($content['sections'] ?? [] as $section) {
            foreach ($section['columns'] ?? [] as $column) {
                foreach ($column['elements'] ?? [] as $element) {
                    if (($element['type'] ?? null) === 'order_form') {
                        $found ??= $element['id'];
                    }
                }
            }
        }
        if ($found === null) {
            throw new RuntimeException('The demo order page has no order form.');
        }

        return $found;
    }
}
