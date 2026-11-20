<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Infrastructure\Models\AssistantConversation;
use App\Modules\AI\Infrastructure\Models\AssistantMessage;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AI2b §4: the shop assistant's conversations for staff — list with filters and previews,
 * transcript with the tools per reply, summary; storefront.manage; customer names only with
 * customers.view; organization isolation.
 */
class AssistantConversationsAdminTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const LIST = '/api/v1/storefront/assistant/conversations';

    /** @var array<string, mixed> */
    private array $t;

    private string $customerId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-11-20 06:00:00', 'UTC'));
        $this->t = $this->provisionTenant('Berry Kids');
        $this->customerId = $this->inTenant($this->t['organization'], fn () => Customer::query()->create(['code' => 'C-1', 'name' => 'Rina Akter', 'phone' => '01711111111'])->id);
    }

    /**
     * @param  list<array{0: string, 1: string, 2?: list<string>|null, 3?: string}>  $messages  [role, text, tools, status]
     */
    private function conversation(Organization $organization, array $messages, ?string $customerId = null, bool $handedOff = false, ?CarbonImmutable $at = null): AssistantConversation
    {
        $at ??= CarbonImmutable::now();

        return $this->inTenant($organization, function () use ($messages, $customerId, $handedOff, $at) {
            $conversation = AssistantConversation::query()->create([
                'token_hash' => hash('sha256', Str::random(40)), 'customer_id' => $customerId, 'language' => 'en',
                'message_count' => count($messages), 'handed_off' => $handedOff, 'started_at' => $at, 'last_message_at' => $at,
            ]);
            foreach ($messages as $i => $m) {
                AssistantMessage::query()->create([
                    'conversation_id' => $conversation->id, 'position' => $i + 1, 'role' => $m[0], 'text' => $m[1],
                    'tools' => $m[2] ?? null, 'status' => $m[3] ?? 'ok', 'created_at' => $at,
                ]);
            }

            return $conversation;
        });
    }

    /**
     * @param  list<string>  $permissions
     */
    private function staff(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Staff '.Str::random(4)]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    public function test_list_transcript_and_summary(): void
    {
        $signedIn = $this->conversation($this->t['organization'], [
            ['user', 'Where is my order BK-1001? I ordered it last week and it has not arrived yet, please check it for me today'],
            ['assistant', 'It is on its way.', ['my_orders', 'order_status']],
            ['user', 'Thanks'],
            ['assistant', 'Sorry, I can\'t answer right now.', null, 'unavailable'],
        ], $this->customerId, true);
        $guest = $this->conversation($this->t['organization'], [
            ['user', 'Do you deliver to Sylhet?'],
            ['assistant', 'Yes.', ['store_policies']],
            ['assistant', 'This chat has reached its limit.', null, 'limit'],
        ], at: CarbonImmutable::now()->subDays(3));
        $this->conversation($this->t['organization'], [['user', 'Old one'], ['assistant', 'Hi', ['search_products']]], at: CarbonImmutable::now()->subDays(40));
        $other = $this->provisionTenant('Other Shop');
        $this->conversation($other['organization'], [['user', 'Other store question'], ['assistant', 'x', ['search_help'], 'budget']]);

        // Without customers.view: no names.
        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage']));
        $rows = $this->getJson(self::LIST)->assertOk()->assertJsonPath('meta.pagination.total', 3)->json('data');
        $this->assertSame([$signedIn->id, $guest->id], array_slice(array_column($rows, 'id'), 0, 2));
        $this->assertSame([
            'id' => $signedIn->id,
            'started_at' => '2026-11-20T06:00:00+00:00',
            'last_message_at' => '2026-11-20T06:00:00+00:00',
            'language' => 'en',
            'signed_in' => true,
            'customer_name' => null,
            'message_count' => 4,
            'handed_off' => true,
            'status' => 'open',
            'preview' => 'Where is my order BK-1001? I ordered it last week and it has not arrived yet, p…',
        ], $rows[0]);
        $this->assertSame(80, mb_strlen($rows[0]['preview']));

        // Filters (store-local dates, Asia/Dhaka), search in messages.
        $this->assertSame([$signedIn->id], array_column($this->getJson(self::LIST.'?handed_off=1')->json('data'), 'id'));
        $this->assertSame([$guest->id], array_column($this->getJson(self::LIST.'?search=SYLHET')->json('data'), 'id'));
        $this->assertSame([$guest->id], array_column($this->getJson(self::LIST.'?from=2026-11-17&to=2026-11-17')->json('data'), 'id'));
        $this->getJson(self::LIST.'?from=2026-11-20&to=2026-11-01')->assertStatus(422);

        $transcript = $this->getJson(self::LIST.'/'.$signedIn->id)->assertOk()->json('data');
        $this->assertNull($transcript['customer_name']);
        $this->assertSame(['user', 'assistant', 'user', 'assistant'], array_column($transcript['messages'], 'role'));
        $this->assertSame(['my_orders', 'order_status'], $transcript['messages'][1]['tools']);
        $this->assertSame([], $transcript['messages'][0]['tools']);
        $this->assertSame('unavailable', $transcript['messages'][3]['status']);
        $this->assertSame(['id', 'role', 'text', 'tools', 'status', 'created_at'], array_keys($transcript['messages'][0]));

        $summary = $this->getJson('/api/v1/storefront/assistant/summary')->assertOk()->json('data');
        $this->assertSame([
            'from' => '2026-10-22',
            'to' => '2026-11-20',
            'conversations' => 2,
            'messages' => 7,
            'handed_off' => 1,
            'handed_off_share' => 0.5,
            'unavailable' => 1,
            'limit' => 1,
            'budget' => 0,
            'top_tools' => [['name' => 'my_orders', 'count' => 1], ['name' => 'order_status', 'count' => 1], ['name' => 'store_policies', 'count' => 1]],
        ], $summary);
        $this->assertSame(0, $this->getJson('/api/v1/storefront/assistant/summary?from=2026-01-01&to=2026-01-31')->json('data.conversations'));

        // Another organization's conversation is not found.
        $foreign = AssistantConversation::query()->withoutGlobalScopes()->where('organization_id', $other['organization']->id)->value('id');
        $this->getJson(self::LIST.'/'.$foreign)->assertNotFound();

        // With customers.view: the name.
        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage', 'customers.view']));
        $this->assertSame('Rina Akter', $this->getJson(self::LIST)->json('data.0.customer_name'));
        $this->assertSame('Rina Akter', $this->getJson(self::LIST.'/'.$signedIn->id)->json('data.customer_name'));
        $this->assertNull($this->getJson(self::LIST)->json('data.1.customer_name'));
    }

    public function test_needs_storefront_manage(): void
    {
        $conversation = $this->conversation($this->t['organization'], [['user', 'Hi']]);
        $this->actingAsUser($this->staff(['storefront.view', 'customers.view']));
        $this->getJson(self::LIST)->assertForbidden();
        $this->getJson(self::LIST.'/'.$conversation->id)->assertForbidden();
        $this->getJson('/api/v1/storefront/assistant/summary')->assertForbidden();
    }
}
