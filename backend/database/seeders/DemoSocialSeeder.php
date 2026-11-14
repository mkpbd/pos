<?php

namespace Database\Seeders;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Application\Actions\ConnectMeta;
use App\Modules\Social\Application\Actions\ManageProductFeeds;
use App\Modules\Social\Application\Actions\PublishSocialPost;
use App\Modules\Social\Application\Actions\SaveSocialPost;
use App\Modules\Social\Application\Actions\SaveSocialSettings;
use App\Modules\Social\Application\Actions\SocialPostWorkflow;
use App\Modules\Social\Domain\CaptionTemplates;
use App\Modules\Social\Domain\FeedChannel;
use App\Modules\Social\Infrastructure\Models\SocialSettings;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * P2b: social media on one demo store (Little Sprouts, kids.shop.localhost) — sandbox mode with
 * the simulated "Demo Page" / @demo_shop connected, the Meta, TikTok and Pinterest feeds enabled,
 * two published posts (Facebook + Instagram in English; Facebook in Bangla) and one post scheduled
 * for tomorrow 10:00 store time. DemoThemesSeeder applies it to the store when it creates it; run it
 * on its own to upgrade a demo store created before P2b:
 *
 *   php artisan db:seed --class=DemoSocialSeeder
 *
 * Idempotent: a store that already has social settings is skipped. Everything goes through the
 * same actions as the API (sandbox: no network call). Development only.
 */
class DemoSocialSeeder extends Seeder
{
    public const STORE = 'kids';

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo store seeder must not run in production.');
        }

        /** @var array<string, mixed> $data */
        $data = require DemoThemesSeeder::path(self::STORE.'.php');
        $organizationId = StorefrontDomain::query()->withoutGlobalScopes()->where('host', $data['host'])->value('organization_id');
        if ($organizationId === null) {
            $this->command?->line("  {$data['name']}: not seeded yet, skipped.");

            return;
        }
        $ownerId = DB::table('users')->where('email', $data['owner']['email'])->value('id');

        app(TenantContext::class)->runAs($organizationId, function () use ($data, $ownerId) {
            if (SocialSettings::query()->exists()) {
                $this->command?->line("  {$data['name']}: already has social settings, skipped.");

                return;
            }
            DB::transaction(fn () => self::apply($data, is_string($ownerId) ? $ownerId : null));
            $this->command?->info("  {$data['name']}: sandbox Facebook Page, three posts and the product feeds added.");
        });
    }

    /**
     * Adds the store's P2b demo data (inside its tenant context, after its catalog and P2a data).
     *
     * @param  array<string, mixed>  $data  the store's data file
     */
    public static function apply(array $data, ?string $ownerId): void
    {
        $organizationId = app(TenantContext::class)->requireOrganization();
        app(SaveSocialSettings::class)(['mode' => 'sandbox']);
        app(ConnectMeta::class)->start((string) $ownerId, $organizationId);

        $feeds = app(ManageProductFeeds::class);
        foreach (FeedChannel::cases() as $channel) {
            $feeds->setEnabled($channel, true);
        }

        $products = self::products(3);
        $save = app(SaveSocialPost::class);
        $workflow = app(SocialPostWorkflow::class);
        $publish = app(PublishSocialPost::class);
        $store = (string) $data['name'];

        foreach ([
            [$products[0] ?? null, ['facebook', 'instagram'], 'en', 'friendly', 1],
            [$products[1] ?? null, ['facebook'], 'bn', 'festive', 2],
        ] as [$product, $targets, $language, $tone, $photos]) {
            if ($product === null) {
                continue;
            }
            $post = $save->create([
                'caption' => self::caption($product, $store, $language, $tone),
                'targets' => $targets,
                'image_ids' => array_slice($product['image_ids'], 0, $photos),
                'product_id' => $product['id'],
            ]);
            $workflow->publish($post);
            // Published at once (the queued job finds nothing left to do).
            $publish($post->id);
        }

        if (($product = $products[2] ?? null) !== null) {
            $timezone = (string) (DB::table('organizations')->where('id', $organizationId)->value('timezone') ?: config('app.timezone'));
            $save->create([
                'caption' => self::caption($product, $store, 'en', 'short'),
                'targets' => ['facebook', 'instagram'],
                'image_ids' => array_slice($product['image_ids'], 0, 2),
                'product_id' => $product['id'],
                'scheduled_at' => CarbonImmutable::now($timezone)->addDay()->setTime(10, 0)->toIso8601String(),
            ]);
        }
    }

    /**
     * Featured products on sale online that have photos: id, name, price and photo ids.
     *
     * @return list<array{id: string, name: string, price: string, image_ids: list<string>}>
     */
    private static function products(int $count): array
    {
        $result = [];
        foreach (app(StorefrontCatalog::class)->sourceProductCards('featured', null, 20) as $card) {
            $images = DB::table('product_images')->where('product_id', $card['id'])->orderBy('sort_order')->orderBy('id')->pluck('id')->map(fn ($id) => (string) $id)->all();
            if ($images !== []) {
                $result[] = ['id' => (string) $card['id'], 'name' => (string) $card['name'], 'price' => (string) $card['price'], 'image_ids' => $images];
            }
            if (count($result) === $count) {
                break;
            }
        }

        return $result;
    }

    /**
     * @param  array{name: string, price: string}  $product
     */
    private static function caption(array $product, string $store, string $language, string $tone): string
    {
        return CaptionTemplates::captions(['name' => $product['name'], 'price' => $product['price'], 'store' => $store], $language, $tone)[0];
    }
}
