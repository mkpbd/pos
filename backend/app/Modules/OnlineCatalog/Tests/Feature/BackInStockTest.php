<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\OnlineCatalog\Infrastructure\Models\BackInStockRequest;
use App\Modules\OnlineCatalog\Infrastructure\Notifications\BackInStockEmail;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * P1a: "Notify me when it's back": the public request, the staff list and counts, and the
 * stock change → one e-mail path (Inventory's StockBecameAvailable at the fulfilment store).
 */
class BackInStockTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $tenant;

    /** @var array<string, mixed> */
    private array $product;

    /** T-shirt S (1 in stock) / M (sold out), published on berry.test. */
    private function shop(): void
    {
        $this->tenant = $this->openStore('Berry Kids', 'berry.test');
        $this->product = $this->makeProduct($this->tenant['unit']->id, 'T-shirt', [
            ['TEE-S', '500.00', ['Size' => 'S']],
            ['TEE-M', '500.00', ['Size' => 'M']],
        ], ['options' => [['name' => 'Size', 'values' => ['S', 'M']]]]);
        $this->publish($this->product['id'], ['translations' => ['bn' => ['name' => 'টি-শার্ট']]]);
        $this->stockUp($this->tenant, [$this->product['variants'][0]['id'] => '1']);
        $this->asVisitor();
    }

    private function sizeM(): string
    {
        return $this->product['variants'][1]['id'];
    }

    public function test_shoppers_ask_once_and_staff_see_the_requests(): void
    {
        $this->shop();
        $url = 'http://berry.test/api/v1/store/products/t-shirt/notify';

        $this->postJson($url, ['variant_id' => $this->sizeM(), 'email' => 'Rina@Example.com'])->assertStatus(202)
            ->assertJsonPath('data.message', 'Thanks! We will e-mail you once when it is back in stock.');
        // Same answer for a repeat (any case) and for the honeypot; nothing more is stored.
        $this->postJson($url.'?lang=bn', ['variant_id' => $this->sizeM(), 'email' => 'rina@example.com'])->assertStatus(202)
            ->assertJsonPath('data.message', 'ধন্যবাদ! পণ্যটি আবার স্টকে এলে আমরা আপনাকে একবার ই-মেইল করব।');
        $this->postJson($url, ['variant_id' => $this->sizeM(), 'email' => 'bot@example.com', 'website' => 'http://spam.example'])->assertStatus(202);
        $this->postJson($url.'?lang=bn', ['variant_id' => $this->sizeM(), 'email' => 'karim@example.com'])->assertStatus(202);

        $rows = $this->inTenant($this->tenant['organization'], fn () => BackInStockRequest::query()->orderBy('email')->get());
        $this->assertSame(['karim@example.com', 'rina@example.com'], $rows->pluck('email')->all());
        $this->assertSame(['bn', 'en'], $rows->pluck('locale')->all());
        $this->assertSame('http://berry.test', $rows[0]->site_url);

        // Not a variant of this product, inactive or malformed: 422.
        $this->postJson($url, ['variant_id' => '00000000-0000-7000-8000-000000000000', 'email' => 'a@example.com'])->assertUnprocessable()->assertJsonValidationErrors(['variant_id'], 'error.details');
        $this->postJson($url, ['variant_id' => $this->sizeM(), 'email' => 'not-an-email'])->assertUnprocessable()->assertJsonValidationErrors(['email'], 'error.details');
        $this->postJson('http://berry.test/api/v1/store/products/no-such-thing/notify', ['variant_id' => $this->sizeM(), 'email' => 'a@example.com'])->assertUnprocessable();

        // Staff: counts in the product payload and the list, newest first.
        $this->actingAsUser($this->tenant['admin']);
        $this->getJson("/api/v1/products/{$this->product['id']}")->assertOk()
            ->assertJsonPath('data.variants.0.back_in_stock_open', 0)
            ->assertJsonPath('data.variants.1.back_in_stock_open', 2);
        $list = $this->getJson("/api/v1/products/{$this->product['id']}/back-in-stock-requests?status=open")->assertOk()->json();
        $this->assertSame(2, $list['meta']['pagination']['total']);
        $this->assertSame(['M', 'M'], array_column($list['data'], 'variant_label'));
        $this->assertSame(['karim@example.com', 'rina@example.com'], array_column($list['data'], 'email'));
        $this->assertNull($list['data'][0]['notified_at']);

        // Another organization sees nothing of it.
        $foreign = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($foreign['admin']);
        $this->getJson("/api/v1/products/{$this->product['id']}/back-in-stock-requests")->assertNotFound();
        $this->asVisitor();
        $this->postJson('http://other.test/api/v1/store/products/t-shirt/notify', ['variant_id' => $this->sizeM(), 'email' => 'a@example.com'])->assertUnprocessable();
    }

    public function test_stock_coming_back_at_the_fulfilment_store_mails_each_request_once(): void
    {
        $this->shop();
        $url = 'http://berry.test/api/v1/store/products/t-shirt/notify';
        $this->postJson($url, ['variant_id' => $this->sizeM(), 'email' => 'rina@example.com'])->assertStatus(202);
        $this->postJson($url.'?lang=bn', ['variant_id' => $this->sizeM(), 'email' => 'karim@example.com'])->assertStatus(202);
        Notification::fake();

        // Stock at another store does not make it sellable online.
        $warehouse = $this->createBranch($this->tenant['organization'], 'WH');
        $whStore = $this->inTenant($this->tenant['organization'], fn () => Store::query()->where('branch_id', $warehouse->id)->firstOrFail());
        $this->inTenant($this->tenant['organization'], fn () => app(PostStockAdjustment::class)($this->tenant['admin']->fresh(), [
            'store_id' => $whStore->id, 'reason' => 'opening', 'lines' => [['variant_id' => $this->sizeM(), 'quantity' => '5', 'unit_cost' => '1.00']],
        ]));
        Notification::assertNothingSent();

        // Back at the fulfilment store: one e-mail per request, in the shopper's language.
        $this->stockUp($this->tenant, [$this->sizeM() => '2']);
        Notification::assertSentOnDemandTimes(BackInStockEmail::class, 2);
        Notification::assertSentOnDemand(BackInStockEmail::class, function (BackInStockEmail $mail, array $channels, AnonymousNotifiable $to) {
            if ($to->routes['mail'] !== 'karim@example.com') {
                return false;
            }
            $message = $mail->toMail($to);

            return $mail->language === 'bn' && $mail->productName === 'টি-শার্ট' && $mail->variantLabel === 'M'
                && $mail->url === 'http://berry.test/product/t-shirt' && $mail->storeName === 'Berry Kids'
                && str_contains((string) $message->subject, 'আবার স্টকে');
        });
        Notification::assertSentOnDemand(BackInStockEmail::class, function (BackInStockEmail $mail, array $channels, AnonymousNotifiable $to) {
            $text = implode(' ', $mail->toMail($to)->introLines).' '.implode(' ', $mail->toMail($to)->outroLines);

            return $to->routes['mail'] === 'rina@example.com' && $mail->productName === 'T-shirt'
                && str_contains($text, 'T-shirt (M) is back in stock at Berry Kids') && str_contains($text, 'nothing to unsubscribe');
        });
        $this->assertSame(0, $this->inTenant($this->tenant['organization'], fn () => BackInStockRequest::query()->whereNull('notified_at')->count()));

        // More stock (no crossing) mails nobody again; a new request waits for the next time.
        $this->stockUp($this->tenant, [$this->sizeM() => '3']);
        Notification::assertSentOnDemandTimes(BackInStockEmail::class, 2);
        $this->postJson($url, ['variant_id' => $this->sizeM(), 'email' => 'rina@example.com'])->assertStatus(202);
        $this->assertSame(1, $this->inTenant($this->tenant['organization'], fn () => BackInStockRequest::query()->whereNull('notified_at')->count()), 'A notified request does not block a new one.');

        $this->actingAsUser($this->tenant['admin']);
        $notified = $this->getJson("/api/v1/products/{$this->product['id']}/back-in-stock-requests?status=notified")->assertOk()->json('data');
        $this->assertCount(2, $notified);
        $this->assertNotNull($notified[0]['notified_at']);
    }
}
