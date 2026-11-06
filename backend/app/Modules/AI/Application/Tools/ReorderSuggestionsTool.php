<?php

namespace App\Modules\AI\Application\Tools;

use App\Modules\AI\Application\Support\ReorderRows;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Purchasing\Application\Queries\ReorderSuggestions;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * SC1 reorder suggestions of one store (purchases.view): what to buy or transfer and why. The
 * store must be an active store of a branch the user may access (StoreAccess), else the call is
 * rejected. Read-only: creating purchase orders or transfers stays on the Reorder page.
 */
final class ReorderSuggestionsTool implements AiTool
{
    public const NAME = 'reorder_suggestions';

    public function __construct(
        private readonly ReorderSuggestions $suggestions,
        private readonly StoreAccess $stores,
        private readonly TenantUser&Authorizable $user,
        private readonly string $organizationId,
        private readonly int $rowLimit,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'Reorder suggestions for one store (deterministic): per item on hand, on order, in transit, average daily sales, days of cover, reorder point, '
            .'suggested purchase / transfer quantity, reason (below_min | velocity), preferred supplier and lead time. Most urgent first, at most '.$this->rowLimit.' items. '
            .'Use it for "what should I reorder", shortages and stock-out risk.',
            Arguments::schema([
                'store_id' => ['type' => 'string', 'description' => 'The id of a store from the list in the instructions'],
                'only' => ['type' => 'string', 'enum' => ['purchase', 'transfer'], 'description' => 'Only items to buy, or only items to transfer from the source store'],
            ], ['store_id']),
        );
    }

    public function run(array $input): ToolOutput
    {
        if (! $this->user->can('purchases.view')) {
            throw new AuthorizationException;
        }
        $args = Arguments::only($input, ['store_id', 'only']);
        $args = Validator::make($args, [
            'store_id' => ['required', 'uuid'],
            'only' => ['sometimes', Rule::in(['purchase', 'transfer'])],
        ])->validate();
        $store = $this->stores->require($this->user, (string) $args['store_id']);
        $result = $this->suggestions->forStore($this->organizationId, $store['id'], ['only' => $args['only'] ?? null]);
        $rows = $result['rows'];
        $canViewCost = $this->user->can('products.view_cost');

        return new ToolOutput(
            data: [
                'store' => ['id' => $store['id'], 'name' => $store['name'], 'branch' => $store['branch_name']],
                'settings' => array_diff_key($result['settings'], ['source_store_id' => true]),
                'source_store' => $result['source_store'] === null ? null : $result['source_store']['name'],
                'items_total' => count($rows),
                'to_purchase' => count(array_filter($rows, fn (array $r) => Decimal::compare($r['suggested_purchase'], '0') > 0)),
                'to_transfer' => count(array_filter($rows, fn (array $r) => Decimal::compare($r['suggested_transfer'], '0') > 0)),
                'items' => ReorderRows::forModel($rows, $canViewCost, $this->rowLimit),
                'truncated' => count($rows) > $this->rowLimit,
            ],
            params: $args,
        );
    }
}
