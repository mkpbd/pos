<?php

namespace Database\Seeders;

use App\Modules\OnlineCatalog\Infrastructure\ReadModels\ProductAffinityProjection;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Reviews\Application\Actions\AskProductQuestion;
use App\Modules\Reviews\Application\Actions\ModerateProductQuestion;
use App\Modules\Reviews\Application\Events\ProductQuestionAnswered;
use App\Modules\Reviews\Application\Events\ProductQuestionAsked;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use RuntimeException;

/**
 * P1b: the product page's extras for the demo stores — the answered shopper questions of each
 * store's data file (`questions`, two products per store, one asked in Bangla) and the
 * "frequently bought together" scores computed from the stores' demo orders and counter sale.
 * DemoThemesSeeder applies it to every new demo store; run it on its own to upgrade demo stores
 * created before P1b:
 *
 *   php artisan db:seed --class=DemoProductPageSeeder
 *
 * Idempotent: a store that already has product questions only gets its scores recomputed.
 * Questions go through the same actions as the API (asked, then answered and published by the
 * store owner); the staff notification and the asker's e-mail are left out. Development only.
 */
class DemoProductPageSeeder extends Seeder
{
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
            $ownerId = User::query()->withoutGlobalScopes()->where('email', $data['owner']['email'])->value('id');

            app(TenantContext::class)->runAs($organizationId, function () use ($data, $ownerId) {
                $added = ProductQuestion::query()->exists() || $ownerId === null ? 0 : DB::transaction(fn () => self::questions($data, (string) $ownerId));
                $pairs = self::affinities();
                $this->command?->info("  {$data['name']}: {$added} question(s) added, {$pairs} bought-together pair(s).");
            });
        }
    }

    /**
     * Adds the store's P1b demo data (inside its tenant context, after its orders and sales).
     *
     * @param  array<string, mixed>  $data  the store's data file
     */
    public static function apply(array $data, string $ownerId): void
    {
        self::questions($data, $ownerId);
        self::affinities();
    }

    /**
     * @param  array<string, mixed>  $data
     * @return int questions added
     */
    private static function questions(array $data, string $ownerId): int
    {
        $ask = app(AskProductQuestion::class);
        $moderate = app(ModerateProductQuestion::class);
        $count = 0;

        Event::fakeFor(function () use ($data, $ownerId, $ask, $moderate, &$count) {
            foreach ($data['questions'] ?? [] as [$slug, $name, $email, $locale, $question, $answer]) {
                $productId = DB::table('product_listings')->where('organization_id', app(TenantContext::class)->requireOrganization())->where('slug', $slug)->value('product_id');
                if ($productId === null) {
                    continue;
                }
                $asked = $ask((string) $productId, ['name' => $name, 'email' => $email, 'question' => $question], null, $locale, 'http://'.$data['host']);
                if ($asked !== null) {
                    $moderate->answer($asked, $answer, true, $ownerId);
                    $count++;
                }
            }
        }, [ProductQuestionAsked::class, ProductQuestionAnswered::class]);

        return $count;
    }

    /**
     * Frequently bought together from the store's demo orders and counter sale.
     */
    private static function affinities(): int
    {
        $organizationId = app(TenantContext::class)->requireOrganization();
        $timezone = app(OrganizationDirectory::class)->summary($organizationId)['timezone'] ?? (string) config('app.timezone');

        return app(ProductAffinityProjection::class)->rebuild($organizationId, CarbonImmutable::now($timezone)->toDateString());
    }
}
