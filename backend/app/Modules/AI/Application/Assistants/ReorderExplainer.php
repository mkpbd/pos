<?php

namespace App\Modules\AI\Application\Assistants;

use App\Modules\AI\Application\Services\AiGate;
use App\Modules\AI\Application\Services\NarrativeWriter;
use App\Modules\AI\Domain\Llm\Usage;
use App\Modules\AI\Application\Support\ReorderRows;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Access\Authorizable;

/**
 * "Explain with AI" on the Reorder page: the store's deterministic SC1 suggestions (the 50 most
 * urgent, cost only with products.view_cost) → a prioritised narrative. Needs AI (503 otherwise).
 */
final class ReorderExplainer
{
    public const ITEM_LIMIT = 50;

    public function __construct(
        private readonly ReorderSuggestions $suggestions,
        private readonly StoreAccess $stores,
        private readonly NarrativeWriter $narratives,
        private readonly AiGate $gate,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function explain(TenantUser&Authorizable $user, string $organizationId, string $storeId): array
    {
        $this->gate->require($organizationId);
        $store = $this->stores->require($user, $storeId);
        $result = $this->suggestions->forStore($organizationId, $store['id']);
        $rows = $result['rows'];
        $items = ReorderRows::forModel($rows, $user->can('products.view_cost'), self::ITEM_LIMIT);
        $facts = [
            'store' => $store['name'],
            'branch' => $store['branch_name'],
            'source_store' => $result['source_store']['name'] ?? null,
            'settings' => array_diff_key($result['settings'], ['source_store_id' => true]),
            'items_total' => count($rows),
            'to_purchase' => count(array_filter($rows, fn (array $r) => Decimal::compare($r['suggested_purchase'], '0') > 0)),
            'to_transfer' => count(array_filter($rows, fn (array $r) => Decimal::compare($r['suggested_transfer'], '0') > 0)),
            'items_shown' => count($items),
            'items' => $items,
        ];

        if ($rows === []) {
            // Nothing to explain: no model call.
            return $this->response($store, $facts, 'Nothing needs reordering in '.$store['name'].' right now.', null);
        }
        $narrative = $this->narratives->require($organizationId, (string) $user->getAuthIdentifier(), 'explain_reorder', Prompts::reorder(), $facts, 3000);

        return $this->response($store, $facts, $narrative['narrative'] ?? 'The AI could not explain these suggestions. The suggestions themselves are unchanged on the Reorder page.', $narrative);
    }

    /**
     * @param  array<string, mixed>  $store
     * @param  array<string, mixed>  $facts
     * @param  array{narrative: ?string, status: string, model: ?string, usage: Usage}|null  $narrative
     * @return array<string, mixed>
     */
    private function response(array $store, array $facts, string $text, ?array $narrative): array
    {
        return [
            'narrative' => $text,
            'status' => $narrative['status'] ?? 'nothing_to_explain',
            'store' => ['id' => $store['id'], 'name' => $store['name'], 'branch_id' => $store['branch_id'], 'branch_name' => $store['branch_name']],
            'items_total' => $facts['items_total'],
            'items_considered' => $facts['items_shown'],
            'to_purchase' => $facts['to_purchase'],
            'to_transfer' => $facts['to_transfer'],
            'usage' => $narrative === null ? ['input_tokens' => 0, 'output_tokens' => 0] : $narrative['usage']->toArray(),
            'model' => $narrative['model'] ?? null,
            'generated_at' => CarbonImmutable::now()->toIso8601String(),
        ];
    }
}
