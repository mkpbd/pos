<?php

namespace App\Modules\Reviews\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Reviews\Domain\ReviewAuthor;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * E9: verified-purchase product reviews — customer, public and staff endpoints.
 */
class ReviewsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /** @var array<string, string> product ids by SKU */
    private array $p = [];

    /** @var array<string, string> product slugs by SKU */
    private array $slug = [];

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * Registers $email, places an order of $items and has it delivered.
     *
     * @param  array<string, int>  $items
     */
    private function deliveredShopper(string $email, array $items, string $name = 'Rina Akter'): string
    {
        $this->clearBrowser();
        $this->registerShopper(self::HOST, $email, extra: ['name' => $name]);
        $number = $this->customerOrder($items);
        $this->advance($number, 'delivered');
        foreach ($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines') as $line) {
            $this->p[$line['sku']] = $line['product_id'];
            $this->slug[$line['sku']] = substr($line['product_url'], strlen('/product/'));
        }

        return $number;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function submit(string $sku, array $body = []): TestResponse
    {
        return $this->browse('POST', $this->storeUrl('account/reviews'), $body + [
            'product_id' => $this->p[$sku],
            'rating' => 5,
            'title' => 'Great',
            'body' => 'Lovely juice, would buy again.',
        ]);
    }

    private function staff(?SystemRole $role = null): void
    {
        $user = $role === null ? $this->tenant['admin'] : $this->createUserWithRole($this->tenant['organization'], $role);
        $this->actingAsUser($user);
    }

    public function test_only_a_delivered_purchase_can_be_reviewed_once(): void
    {
        config(['pos.review_rate_limit' => 100]);
        $this->registerShopper(self::HOST, 'rina@example.test');
        $number = $this->customerOrder(['JUICE' => 1, 'SHIRT' => 1]);
        $lines = collect($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines'))->keyBy('sku');
        $this->p = ['JUICE' => $lines['JUICE']['product_id'], 'SHIRT' => $lines['SHIRT']['product_id']];

        // Confirmed, shipped: not yet.
        $this->submit('JUICE')->assertUnprocessable()->assertJsonPath('error.code', 'REVIEW_NOT_ALLOWED');
        $this->advance($number, 'shipped');
        $this->submit('JUICE')->assertUnprocessable()->assertJsonPath('error.code', 'REVIEW_NOT_ALLOWED');
        // Never bought (Rice).
        $rice = $this->inTenant($this->tenant['organization'], fn () => ProductVariant::query()->whereKey($this->v['RICE'])->value('product_id'));
        $this->browse('POST', $this->storeUrl('account/reviews'), ['product_id' => $rice, 'rating' => 4, 'body' => 'Never bought it, still…'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'REVIEW_NOT_ALLOWED');

        $admin = (string) $this->tenant['admin']->id;
        $this->inTenant($this->tenant['organization'], fn () => app(OrderWorkflow::class)->deliver($this->orderModel($number), $admin));

        $review = $this->submit('JUICE', ['title' => '  Great  ', 'body' => '  Lovely juice, would buy again.  '])->assertCreated()->json('data');
        $this->assertSame(['pending', 'Pending', 5, 'Great', 'Lovely juice, would buy again.', true, null], [
            $review['status'], $review['status_label'], $review['rating'], $review['title'], $review['body'], $review['verified'], $review['rejection_reason'],
        ]);
        $this->assertSame(['id' => $this->p['JUICE'], 'name' => 'Juice'], array_intersect_key($review['product'], ['id' => 1, 'name' => 1]));
        $this->assertNotNull($review['product']['slug']);
        $stored = Review::query()->withoutGlobalScopes()->findOrFail($review['id']);
        $this->assertSame($this->orderModel($number)->lines()->where('sku', 'JUICE')->value('id'), $stored->order_line_id);

        $this->submit('JUICE', ['rating' => 1])->assertUnprocessable()->assertJsonPath('error.code', 'REVIEW_EXISTS')->assertJsonPath('error.details.review_id', $review['id']);

        // The order page shows it per line; the other line is still reviewable.
        $lines = collect($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines'))->keyBy('sku');
        $this->assertSame(['id' => $review['id'], 'rating' => 5, 'status' => 'pending'], $lines['JUICE']['review']);
        $this->assertFalse($lines['JUICE']['reviewable']);
        $this->assertTrue($lines['SHIRT']['reviewable']);

        // Shape validation.
        $this->submit('SHIRT', ['rating' => 6])->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->submit('SHIRT', ['body' => 'too short'])->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['body']]]);
        $this->submit('SHIRT', ['title' => str_repeat('t', 121)])->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['title']]]);
        $this->submit('SHIRT', ['title' => null])->assertCreated()->assertJsonPath('data.title', null);
    }

    public function test_own_reviews_edit_back_to_pending_and_delete_with_isolation(): void
    {
        $this->deliveredShopper('rina@example.test', ['JUICE' => 1]);
        $review = $this->submit('JUICE')->assertCreated()->json('data');

        $this->staff();
        $this->postJson("/api/v1/reviews/{$review['id']}/reject", ['reason' => 'Mentions a competitor'])->assertOk();

        $this->signIn('rina@example.test');
        $own = $this->browse('GET', $this->storeUrl('account/reviews'))->assertOk()->json();
        $this->assertSame(['rejected', 'Mentions a competitor'], [$own['data'][0]['status'], $own['data'][0]['rejection_reason']]);
        $this->assertSame(1, $own['meta']['pagination']['total']);
        $this->assertSame(['id', 'name', 'slug', 'image_url'], array_keys($own['data'][0]['product']));

        $edited = $this->browse('PATCH', $this->storeUrl("account/reviews/{$review['id']}"), ['rating' => 4, 'body' => 'Changed my mind, still good.'])->assertOk()->json('data');
        $this->assertSame(['pending', 4, 'Great', 'Changed my mind, still good.', null], [$edited['status'], $edited['rating'], $edited['title'], $edited['body'], $edited['rejection_reason']]);
        $this->assertNull(Review::query()->withoutGlobalScopes()->find($review['id'])->moderated_at);

        // Approved, then edited: pending again.
        $this->staff();
        $this->postJson("/api/v1/reviews/{$review['id']}/approve")->assertOk();
        $this->signIn('rina@example.test');
        $this->browse('PATCH', $this->storeUrl("account/reviews/{$review['id']}"), ['title' => ''])->assertOk()
            ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.title', null);

        // Customer B: not theirs.
        $this->clearBrowser();
        $this->registerShopper(self::HOST, 'b@example.test');
        $this->browse('GET', $this->storeUrl('account/reviews'))->assertOk()->assertJsonPath('data', []);
        $this->browse('PATCH', $this->storeUrl("account/reviews/{$review['id']}"), ['rating' => 1])->assertNotFound();
        $this->browse('DELETE', $this->storeUrl("account/reviews/{$review['id']}"))->assertNotFound();
        // B has no delivered purchase of it.
        $this->submit('JUICE')->assertUnprocessable()->assertJsonPath('error.code', 'REVIEW_NOT_ALLOWED');

        // Guests: 401.
        $this->clearBrowser();
        $this->browse('GET', $this->storeUrl('account/reviews'))->assertUnauthorized();
        $this->submit('JUICE')->assertUnauthorized();
        $this->browse('PATCH', $this->storeUrl("account/reviews/{$review['id']}"), ['rating' => 1])->assertUnauthorized();
        $this->browse('DELETE', $this->storeUrl("account/reviews/{$review['id']}"))->assertUnauthorized();

        // Another store's customer and staff: 404.
        $other = $this->openStore('Other Shop', 'other.example.test');
        $this->getJson('/api/v1/reviews')->assertOk()->assertJsonPath('data', []);
        $this->postJson("/api/v1/reviews/{$review['id']}/approve")->assertNotFound();
        $this->postJson("/api/v1/reviews/{$review['id']}/reject")->assertNotFound();
        $this->deleteJson("/api/v1/reviews/{$review['id']}")->assertNotFound();
        $this->asVisitor();
        $this->clearBrowser();
        $this->registerShopper('other.example.test', 'rina@example.test');
        $this->browse('PATCH', $this->storeUrl("account/reviews/{$review['id']}", 'other.example.test'), ['rating' => 1])->assertNotFound();
        $this->browse('DELETE', $this->storeUrl("account/reviews/{$review['id']}", 'other.example.test'))->assertNotFound();
        $this->browse('POST', $this->storeUrl('account/reviews', 'other.example.test'), ['product_id' => $this->p['JUICE'], 'rating' => 5, 'body' => 'Not from this store.'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'REVIEW_NOT_ALLOWED');
        $this->browse('GET', $this->storeUrl("products/{$this->slug['JUICE']}/reviews", 'other.example.test'))->assertNotFound();
        $this->assertNotNull($other);

        // The author deletes it.
        $this->signIn('rina@example.test');
        $this->browse('DELETE', $this->storeUrl("account/reviews/{$review['id']}"))->assertNoContent();
        $this->assertNull(Review::query()->withoutGlobalScopes()->find($review['id']));
        // ...and may write a new one.
        $this->submit('JUICE')->assertCreated();
    }

    public function test_public_reviews_are_approved_only_with_summary_sort_and_filter(): void
    {
        $authors = [
            ['a@example.test', 'Rina Akter', 5],
            ['b@example.test', 'Karim', 4],
            ['c@example.test', 'Nusrat Jahan Chowdhury', 4],
            ['d@example.test', 'Tanvir Hasan', 1],
        ];
        $ids = [];
        foreach ($authors as [$email, $name, $rating]) {
            $this->deliveredShopper($email, ['JUICE' => 1], $name);
            $ids[$email] = $this->submit('JUICE', ['rating' => $rating, 'title' => "{$rating} stars"])->assertCreated()->json('data.id');
            $this->travel(1)->minutes();
        }

        $url = $this->storeUrl("products/{$this->slug['JUICE']}/reviews");
        $this->clearBrowser();
        // Nothing approved yet.
        $empty = $this->browse('GET', $url)->assertOk()->json();
        $this->assertSame([], $empty['data']);
        $this->assertSame(['average' => null, 'count' => 0, 'distribution' => ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 0]], $empty['summary']);
        $this->assertNull($this->browse('GET', $this->storeUrl("products/{$this->slug['JUICE']}"))->json('data.rating'));

        $this->staff();
        foreach (['a@example.test', 'b@example.test', 'c@example.test'] as $email) {
            $this->postJson("/api/v1/reviews/{$ids[$email]}/approve")->assertOk();
        }
        $this->postJson("/api/v1/reviews/{$ids['d@example.test']}/reject")->assertOk();
        $this->asVisitor();

        $page = $this->browse('GET', $url)->assertOk()->json();
        $this->assertSame([$ids['c@example.test'], $ids['b@example.test'], $ids['a@example.test']], array_column($page['data'], 'id'));
        $this->assertSame(['id', 'rating', 'title', 'body', 'author', 'created_at', 'verified'], array_keys($page['data'][0]));
        $this->assertSame(['Nusrat C.', 'Karim', 'Rina A.'], array_column($page['data'], 'author'));
        $this->assertSame([true, true, true], array_column($page['data'], 'verified'));
        $this->assertSame(['average' => '4.3', 'count' => 3, 'distribution' => ['1' => 0, '2' => 0, '3' => 0, '4' => 2, '5' => 1]], $page['summary']);
        $this->assertSame(['current_page' => 1, 'per_page' => 10, 'total' => 3, 'last_page' => 1], $page['meta']['pagination']);
        $this->assertStringNotContainsString('example.test', json_encode($page['data']));

        $this->assertSame([5, 4, 4], array_column($this->browse('GET', $url.'?sort=highest')->json('data'), 'rating'));
        $this->assertSame([4, 4, 5], array_column($this->browse('GET', $url.'?sort=lowest')->json('data'), 'rating'));
        $filtered = $this->browse('GET', $url.'?rating=4')->json();
        $this->assertSame([4, 4], array_column($filtered['data'], 'rating'));
        $this->assertSame(3, $filtered['summary']['count']);
        $this->browse('GET', $url.'?sort=best')->assertUnprocessable();
        $this->browse('GET', $this->storeUrl('products/no-such-product/reviews'))->assertNotFound();

        $this->assertSame(['average' => '4.3', 'count' => 3], $this->browse('GET', $this->storeUrl("products/{$this->slug['JUICE']}"))->json('data.rating'));

        // An unpublished product has no public reviews.
        $this->staff();
        $this->putJson("/api/v1/online-catalog/products/{$this->p['JUICE']}", ['is_published' => false, 'is_featured' => false])->assertOk();
        $this->asVisitor();
        $this->browse('GET', $url)->assertNotFound();
    }

    public function test_staff_moderation_list_idempotency_and_audit(): void
    {
        $this->deliveredShopper('rina@example.test', ['JUICE' => 1, 'SHIRT' => 1]);
        $juice = $this->submit('JUICE', ['rating' => 5, 'title' => 'Fresh mango'])->assertCreated()->json('data.id');
        $this->travel(1)->minutes();
        $shirt = $this->submit('SHIRT', ['rating' => 2, 'title' => 'Too small', 'body' => 'The shirt runs small.'])->assertCreated()->json('data.id');

        $this->staff();
        $list = $this->getJson('/api/v1/reviews')->assertOk()->json();
        $this->assertSame([$shirt, $juice], array_column($list['data'], 'id'));
        $this->assertSame(2, $list['meta']['pending_count']);
        $row = $list['data'][1];
        $this->assertSame([
            'id', 'product', 'customer', 'rating', 'title', 'body', 'status', 'created_at', 'moderated_at', 'moderated_by_name', 'rejection_reason',
        ], array_keys($row));
        $this->assertSame(['id' => $this->p['JUICE'], 'name' => 'Juice'], $row['product']);
        $this->assertSame(['Rina Akter', 'rina@example.test'], [$row['customer']['name'], $row['customer']['email']]);

        $approved = $this->postJson("/api/v1/reviews/{$juice}/approve")->assertOk()->json('data');
        $this->assertSame(['approved', $this->tenant['admin']->name], [$approved['status'], $approved['moderated_by_name']]);
        $this->travel(5)->minutes();
        $again = $this->postJson("/api/v1/reviews/{$juice}/approve")->assertOk()->json('data');
        $this->assertSame($approved['moderated_at'], $again['moderated_at']);
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'review.approved')->count());

        $rejected = $this->postJson("/api/v1/reviews/{$shirt}/reject", ['reason' => ' Not about the product '])->assertOk()->json('data');
        $this->assertSame(['rejected', 'Not about the product'], [$rejected['status'], $rejected['rejection_reason']]);
        $this->postJson("/api/v1/reviews/{$shirt}/reject", ['reason' => 'Other'])->assertOk()->assertJsonPath('data.rejection_reason', 'Not about the product');
        $this->postJson("/api/v1/reviews/{$shirt}/reject", ['reason' => str_repeat('r', 201)])->assertUnprocessable();
        // Rejected → approved clears the reason.
        $this->postJson("/api/v1/reviews/{$shirt}/approve")->assertOk()->assertJsonPath('data.rejection_reason', null);
        $this->postJson("/api/v1/reviews/{$shirt}/reject")->assertOk()->assertJsonPath('data.rejection_reason', null);

        // Filters and search.
        $this->assertSame([$juice], array_column($this->getJson('/api/v1/reviews?status=approved')->json('data'), 'id'));
        $this->assertSame([$shirt], array_column($this->getJson('/api/v1/reviews?rating=2')->json('data'), 'id'));
        $this->assertSame([$juice], array_column($this->getJson('/api/v1/reviews?search=mango')->json('data'), 'id'));
        $this->assertSame([$shirt], array_column($this->getJson('/api/v1/reviews?search=shirt')->json('data'), 'id'));
        $this->assertCount(2, $this->getJson('/api/v1/reviews?search=RINA@example')->json('data'));
        $this->assertSame(0, $this->getJson('/api/v1/reviews')->json('meta.pending_count'));
        $this->getJson('/api/v1/reviews?status=hidden')->assertUnprocessable();

        $this->deleteJson("/api/v1/reviews/{$shirt}")->assertNoContent();
        $this->deleteJson("/api/v1/reviews/{$shirt}")->assertNotFound();
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'review.deleted')->count());
    }

    public function test_review_permissions(): void
    {
        $this->deliveredShopper('rina@example.test', ['JUICE' => 1]);
        $id = $this->submit('JUICE')->assertCreated()->json('data.id');

        // Cashier: nothing.
        $this->staff(SystemRole::Cashier);
        $this->getJson('/api/v1/reviews')->assertForbidden();
        $this->postJson("/api/v1/reviews/{$id}/approve")->assertForbidden();

        // View only: list, no moderation.
        $this->staff();
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Review reader', 'permissions' => ['reviews.view']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($this->tenant['organization'], Role::query()->withoutGlobalScopes()->findOrFail($roleId));
        $this->actingAsUser($reader);
        $this->getJson('/api/v1/reviews')->assertOk();
        $this->postJson("/api/v1/reviews/{$id}/approve")->assertForbidden();
        $this->postJson("/api/v1/reviews/{$id}/reject")->assertForbidden();
        $this->deleteJson("/api/v1/reviews/{$id}")->assertForbidden();

        // Online Store Manager: both.
        $this->staff(SystemRole::OnlineStoreManager);
        $this->getJson('/api/v1/reviews')->assertOk();
        $this->postJson("/api/v1/reviews/{$id}/approve")->assertOk();

        // Guests of the staff API.
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/reviews')->assertUnauthorized();
    }

    public function test_new_reviews_are_rate_limited_per_customer(): void
    {
        config(['pos.review_rate_limit' => 3]);
        $this->deliveredShopper('rina@example.test', ['JUICE' => 1]);
        for ($i = 0; $i < 3; $i++) {
            $this->submit('JUICE')->assertStatus($i === 0 ? 201 : 422);
        }
        $this->submit('JUICE')->assertStatus(429);
        // Editing is not limited by it.
        $id = Review::query()->withoutGlobalScopes()->value('id');
        $this->browse('PATCH', $this->storeUrl("account/reviews/{$id}"), ['rating' => 3])->assertOk();
    }

    public function test_public_author_name(): void
    {
        $this->assertSame('Rina A.', ReviewAuthor::publicName('Rina Akter'));
        $this->assertSame('Rina', ReviewAuthor::publicName(' Rina '));
        $this->assertSame('Nusrat C.', ReviewAuthor::publicName('Nusrat Jahan chowdhury'));
        $this->assertSame('Customer', ReviewAuthor::publicName(''));
        $this->assertSame('শাহানা B.', ReviewAuthor::publicName('শাহানা begum'));
    }
}
