<?php

namespace App\Modules\Reviews\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Reviews\Infrastructure\Models\ProductQuestion;
use App\Modules\Reviews\Infrastructure\Notifications\ProductQuestionAnsweredEmail;
use App\Modules\Reviews\Infrastructure\Notifications\ProductQuestionNotification;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P1b: shoppers' questions about a product — asked by guests or signed-in shoppers, answered,
 * published, rejected and deleted by staff, the answer e-mailed once, the product page's list
 * and count, permissions and tenant isolation.
 */
class ProductQuestionsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function ask(string $slug, array $body = [], string $query = ''): TestResponse
    {
        return $this->browse('POST', $this->storeUrl("products/{$slug}/questions".($query === '' ? '' : '?'.$query)), $body + [
            'name' => 'Rina Akter',
            'email' => 'Rina@Example.test',
            'question' => 'Does this shirt shrink after washing?',
            'website' => '',
        ]);
    }

    private function staff(?SystemRole $role = null): void
    {
        $this->actingAsUser($role === null ? $this->tenant['admin'] : $this->createUserWithRole($this->tenant['organization'], $role));
    }

    private function questionId(string $text): string
    {
        return ProductQuestion::query()->withoutGlobalScopes()->where('question', $text)->valueOrFail('id');
    }

    public function test_a_guest_asks_staff_answer_and_the_answer_shows_on_the_product_page(): void
    {
        $this->ask('shirt')->assertStatus(202)->assertJsonPath('data.message', 'Thanks — your question will appear once we answer it.');
        $this->ask('shirt', ['question' => 'শার্টটি কি সুতির?'], 'lang=bn')->assertStatus(202)
            ->assertJsonPath('data.message', 'ধন্যবাদ — উত্তর দেওয়ার পর আপনার প্রশ্নটি এখানে দেখা যাবে।');
        $this->ask('juice', ['name' => 'Karim', 'email' => 'karim@example.test', 'question' => 'Is there added sugar?'])->assertStatus(202);

        // Pending questions are not public.
        $this->getJson($this->storeUrl('products/shirt/questions'))->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.pagination.total', 0);
        $this->assertSame(0, $this->getJson($this->storeUrl('products/shirt'))->json('data.questions_count'));

        // Staff who moderate reviews hear about each question.
        $admin = $this->tenant['admin'];
        Notification::assertSentTo($admin, ProductQuestionNotification::class, function (ProductQuestionNotification $n) use ($admin) {
            $data = $n->toArray($admin);

            return $data['title'] === 'New product question' && $data['link'] === '/reviews/questions?status=pending'
                && str_starts_with($data['message'], 'Rina Akter asked about Shirt: Does this shirt');
        });
        $stored = ProductQuestion::query()->withoutGlobalScopes()->where('question', 'Does this shirt shrink after washing?')->firstOrFail();
        $this->assertSame(['rina@example.test', 'en', 'pending', null, 'http://shop.example.test'], [$stored->email, $stored->locale, $stored->status->value, $stored->customer_account_id, $stored->site_url]);
        $this->assertSame('bn', ProductQuestion::query()->withoutGlobalScopes()->where('question', 'শার্টটি কি সুতির?')->value('locale'));

        // The staff list: pending first, filters and the pending count.
        $this->staff(SystemRole::OnlineStoreManager);
        $list = $this->getJson('/api/v1/reviews/questions')->assertOk();
        $list->assertJsonPath('meta.pending_count', 3)->assertJsonPath('meta.pagination.total', 3);
        $row = collect($list->json('data'))->firstWhere('question', 'Does this shirt shrink after washing?');
        $this->assertSame(['name' => 'Shirt', 'slug' => 'shirt'], array_intersect_key($row['product'], ['name' => 1, 'slug' => 1]));
        $this->assertSame(['Rina Akter', 'rina@example.test', null, 'pending', 'en', null, null], [$row['name'], $row['email'], $row['answer'], $row['status'], $row['locale'], $row['answered_at'], $row['answered_by_name']]);
        $this->assertCount(1, $this->getJson('/api/v1/reviews/questions?search=SUGAR')->json('data'));
        $this->assertCount(1, $this->getJson('/api/v1/reviews/questions?search=karim@')->json('data'));
        $this->assertCount(1, $this->getJson('/api/v1/reviews/questions?search=juice')->json('data'), 'Matches the product name.');
        $this->assertCount(2, $this->getJson("/api/v1/reviews/questions?product={$row['product']['id']}")->json('data'));
        $this->getJson('/api/v1/reviews/questions?status=answered')->assertUnprocessable();

        // A saved but unpublished answer stays hidden; publishing shows it and e-mails the asker once.
        $id = $row['id'];
        $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => '', 'publish' => true])->assertUnprocessable();
        $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => str_repeat('x', 2001), 'publish' => true])->assertUnprocessable();
        $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => 'Pre-washed: it keeps its size.', 'publish' => false])->assertOk()
            ->assertJsonPath('data.status', 'pending')->assertJsonPath('data.answer', 'Pre-washed: it keeps its size.');
        Notification::assertSentOnDemandTimes(ProductQuestionAnsweredEmail::class, 0);
        $answered = $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => ' Pre-washed: it keeps its size at 30 °C. ', 'publish' => true])->assertOk()->json('data');
        $this->assertSame(['published', 'Pre-washed: it keeps its size at 30 °C.'], [$answered['status'], $answered['answer']]);
        $this->assertNotNull($answered['answered_at']);
        $this->assertNotNull($answered['answered_by_name']);
        $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => 'Pre-washed: it keeps its size at 30 °C, hang to dry.', 'publish' => true])->assertOk();
        Notification::assertSentOnDemandTimes(ProductQuestionAnsweredEmail::class, 1);
        Notification::assertSentOnDemand(ProductQuestionAnsweredEmail::class, function (ProductQuestionAnsweredEmail $mail, array $channels, AnonymousNotifiable $notifiable) {
            return $notifiable->routes['mail'] === 'rina@example.test' && $mail->language === 'en' && $mail->productName === 'Shirt'
                && $mail->url === 'http://shop.example.test/product/shirt' && $mail->answer === 'Pre-washed: it keeps its size at 30 °C.';
        });
        $audits = AuditLog::query()->withoutGlobalScopes()->where('action', 'like', 'product_question.%')->pluck('action')->countBy()->all();
        $this->assertSame(['product_question.answered' => 1, 'product_question.published' => 2], $audits);

        // The Bangla question's answer goes out in Bangla.
        $bn = $this->questionId('শার্টটি কি সুতির?');
        $this->postJson("/api/v1/reviews/questions/{$bn}/answer", ['answer' => 'হ্যাঁ, ১০০% সুতি।', 'publish' => true])->assertOk();
        Notification::assertSentOnDemand(ProductQuestionAnsweredEmail::class, fn (ProductQuestionAnsweredEmail $mail) => $mail->language === 'bn' && $mail->answer === 'হ্যাঁ, ১০০% সুতি।');

        // Public: published questions only, the asker's first name and last initial, never the e-mail.
        $this->asVisitor();
        $public = $this->getJson($this->storeUrl('products/shirt/questions'))->assertOk();
        $public->assertJsonPath('meta.pagination.total', 2);
        $rows = $public->json('data');
        $this->assertSame(['id', 'name', 'question', 'answer', 'asked_at', 'answered_at'], array_keys($rows[0]));
        $this->assertSame(['Rina A.', 'Rina A.'], array_column($rows, 'name'));
        $this->assertStringNotContainsString('example.test', (string) $public->getContent());
        $this->assertSame(2, $this->getJson($this->storeUrl('products/shirt'))->json('data.questions_count'));
        $this->getJson($this->storeUrl('products/juice/questions'))->assertOk()->assertJsonPath('data', []);

        // Rejecting hides it again (no second e-mail); deleting removes it.
        $this->staff();
        $this->postJson("/api/v1/reviews/questions/{$id}/reject")->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->postJson("/api/v1/reviews/questions/{$id}/reject")->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->deleteJson("/api/v1/reviews/questions/{$bn}")->assertNoContent();
        $this->asVisitor();
        $this->assertSame(0, $this->getJson($this->storeUrl('products/shirt'))->json('data.questions_count'));
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'product_question.rejected')->count());
        $this->assertSame(1, AuditLog::query()->withoutGlobalScopes()->where('action', 'product_question.deleted')->count());
    }

    public function test_questions_need_a_live_product_and_valid_details(): void
    {
        config(['pos.question_rate_limit' => 100]);
        $this->ask('nope')->assertNotFound();
        $this->ask('shirt', ['name' => ''])->assertUnprocessable()->assertJsonValidationErrors(['name'], 'error.details');
        $this->ask('shirt', ['email' => 'not-an-address'])->assertUnprocessable()->assertJsonValidationErrors(['email'], 'error.details');
        $this->ask('shirt', ['question' => 'Hi?'])->assertUnprocessable()->assertJsonValidationErrors(['question'], 'error.details');
        $this->ask('shirt', ['question' => str_repeat('a', 501)])->assertUnprocessable()->assertJsonValidationErrors(['question'], 'error.details');
        $this->ask('shirt', ['name' => str_repeat('a', 81)])->assertUnprocessable()->assertJsonValidationErrors(['name'], 'error.details');

        // Honeypot: the same answer, nothing kept.
        $this->ask('shirt', ['website' => 'https://spam.example'])->assertStatus(202);
        $this->assertSame(0, ProductQuestion::query()->withoutGlobalScopes()->count());
        $this->getJson($this->storeUrl('products/nope/questions'))->assertNotFound();
    }

    public function test_a_visitor_may_ask_a_handful_of_questions_an_hour(): void
    {
        foreach (range(1, 5) as $i) {
            $this->ask('shirt', ['question' => "Question number {$i}?"])->assertStatus(202);
        }
        $this->ask('juice')->assertStatus(429);
        $this->assertSame(5, ProductQuestion::query()->withoutGlobalScopes()->count());
    }

    public function test_a_signed_in_shoppers_account_is_linked(): void
    {
        $this->registerShopper(self::HOST, 'mina@example.test', extra: ['name' => 'Mina Rahman']);
        $this->ask('shirt', ['name' => 'Mina Rahman', 'email' => 'mina@example.test'])->assertStatus(202);

        $accountId = DB::table('customer_accounts')->where('email', 'mina@example.test')->value('id');
        $this->assertNotNull($accountId);
        $this->assertSame($accountId, ProductQuestion::query()->withoutGlobalScopes()->value('customer_account_id'));
    }

    public function test_staff_permissions_and_tenant_isolation(): void
    {
        $this->ask('shirt')->assertStatus(202);
        $id = $this->questionId('Does this shirt shrink after washing?');

        $this->staff(SystemRole::Cashier);
        $this->getJson('/api/v1/reviews/questions')->assertForbidden();
        $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => 'Yes', 'publish' => true])->assertForbidden();
        $this->postJson("/api/v1/reviews/questions/{$id}/reject")->assertForbidden();
        $this->deleteJson("/api/v1/reviews/questions/{$id}")->assertForbidden();

        // Another store's staff never see or touch this store's questions.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($other['admin']);
        $this->getJson('/api/v1/reviews/questions')->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.pending_count', 0);
        $this->postJson("/api/v1/reviews/questions/{$id}/answer", ['answer' => 'Yes', 'publish' => true])->assertNotFound();
        $this->postJson("/api/v1/reviews/questions/{$id}/reject")->assertNotFound();
        $this->deleteJson("/api/v1/reviews/questions/{$id}")->assertNotFound();
        $this->assertSame('pending', ProductQuestion::query()->withoutGlobalScopes()->whereKey($id)->firstOrFail()->status->value);
        // Its moderators were not told about this store's question.
        Notification::assertNotSentTo($other['admin'], ProductQuestionNotification::class);

        // A slug of this store on another store's host is unknown there.
        $this->asVisitor();
        $this->browse('POST', 'http://other.test/api/v1/store/products/shirt/questions', ['name' => 'A', 'email' => 'a@example.test', 'question' => 'Is it here?'])->assertNotFound();
        $this->getJson('http://other.test/api/v1/store/products/shirt/questions')->assertNotFound();
    }
}
