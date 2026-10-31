<?php

namespace App\Modules\Loyalty\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Loyalty\Application\Services\PointsLedger;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltyAccount;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltySettings;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltyTransaction;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Loyalty program settings, customer point balances and history, manual adjustments.
 */
class LoyaltyController
{
    private const SETTINGS = ['is_enabled', 'spend_amount', 'points_per_spend', 'point_value', 'min_redeem_points'];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CustomerDirectory $customers,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * Program settings
     *
     * Readable by anyone who sells or looks after customers (the till needs the point value).
     */
    public function settings(Request $request): JsonResponse
    {
        $this->authorizeRead($request);

        return ApiResponse::success($this->presentSettings(LoyaltySettings::query()->first() ?? new LoyaltySettings));
    }

    /**
     * Update program settings
     *
     * `{is_enabled, spend_amount, points_per_spend, point_value, min_redeem_points}`. Earning and
     * redemption use the new values from now on; points already booked keep their value.
     */
    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'is_enabled' => ['sometimes', 'boolean'],
            'spend_amount' => ['sometimes', 'decimal:0,2', 'gt:0', 'max:99999999'],
            'points_per_spend' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'point_value' => ['sometimes', 'decimal:0,2', 'gt:0', 'max:99999999'],
            'min_redeem_points' => ['sometimes', 'integer', 'min:0', 'max:100000000'],
        ]);

        $settings = DB::transaction(function () use ($data, $request) {
            $settings = LoyaltySettings::query()->lockForUpdate()->first() ?? new LoyaltySettings(['organization_id' => $this->tenant->requireOrganization()]);
            $before = $settings->exists ? $settings->only(self::SETTINGS) : [];
            $settings->fill($data + ['updated_by' => $request->user()->getAuthIdentifier()])->save();
            [$old, $new] = Changes::between($before, $settings->only(self::SETTINGS));
            if ($new !== []) {
                $this->audit->record('loyalty.settings_updated', $settings, $old, $new);
            }

            return $settings;
        });

        return ApiResponse::success($this->presentSettings($settings));
    }

    /**
     * Point balances
     *
     * `customer_ids[]` (max 100) → `{customer_id: points}`.
     */
    public function balances(Request $request): JsonResponse
    {
        $this->authorizeRead($request);
        $data = $request->validate(['customer_ids' => ['required', 'array', 'max:100'], 'customer_ids.*' => ['uuid']]);
        $ids = array_values(array_unique($data['customer_ids']));
        $balances = LoyaltyAccount::query()->whereIn('customer_id', $ids)->pluck('balance', 'customer_id');

        return ApiResponse::success((object) array_map(fn (string $id) => (int) ($balances[$id] ?? 0), array_combine($ids, $ids)));
    }

    /**
     * Customer points
     *
     * Balance, lifetime totals and the latest 100 transactions.
     */
    public function customer(Request $request, string $customerId): JsonResponse
    {
        $this->authorizeRead($request);
        $customer = $this->customers->find($customerId, $this->tenant->requireOrganization()) ?? throw new NotFoundHttpException;
        $account = LoyaltyAccount::query()->where('customer_id', $customerId)->first();

        return ApiResponse::success([
            'customer' => ['id' => $customer['id'], 'code' => $customer['code'], 'name' => $customer['name']],
            'balance' => $account->balance ?? 0,
            'lifetime_earned' => $account->lifetime_earned ?? 0,
            'lifetime_redeemed' => $account->lifetime_redeemed ?? 0,
            'transactions' => LoyaltyTransaction::query()->where('customer_id', $customerId)->latest('created_at')->limit(100)->get()
                ->map(fn (LoyaltyTransaction $t) => [
                    'id' => $t->id,
                    'type' => $t->type,
                    'points' => $t->points,
                    'balance_after' => $t->balance_after,
                    'value' => $t->value,
                    'source_type' => $t->source_type,
                    'source_id' => $t->source_id,
                    'source_number' => $t->source_number,
                    'notes' => $t->notes,
                    'created_at' => $t->created_at->toIso8601String(),
                ])->all(),
        ]);
    }

    /**
     * Adjust points
     *
     * `{points (signed, non-zero), notes}` — goodwill credits or corrections.
     */
    public function adjust(Request $request, string $customerId, PointsLedger $ledger): JsonResponse
    {
        $data = $request->validate([
            'points' => ['required', 'integer', 'not_in:0', 'min:-10000000', 'max:10000000'],
            'notes' => ['required', 'string', 'max:255'],
        ]);
        $customer = $this->customers->find($customerId, $this->tenant->requireOrganization()) ?? throw new NotFoundHttpException;

        $transaction = DB::transaction(function () use ($ledger, $customer, $data) {
            $transaction = $ledger->post($customer['id'], (int) $data['points'], ['type' => 'adjustment', 'source_type' => 'manual', 'notes' => trim($data['notes'])]);
            $this->audit->record('loyalty.adjusted', $transaction, new: ['customer' => $customer['code'], 'points' => (int) $data['points'], 'notes' => trim($data['notes'])]);

            return $transaction;
        });

        return ApiResponse::created(['points' => $transaction->points, 'balance' => $transaction->balance_after]);
    }

    private function authorizeRead(Request $request): void
    {
        if (! Gate::forUser($request->user())->any(['loyalty.view', 'loyalty.manage', 'customers.view', 'pos.sell'])) {
            throw new AccessDeniedHttpException;
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function presentSettings(LoyaltySettings $settings): array
    {
        return [
            'is_enabled' => $settings->is_enabled,
            'spend_amount' => $settings->spend_amount,
            'points_per_spend' => $settings->points_per_spend,
            'point_value' => $settings->point_value,
            'min_redeem_points' => $settings->min_redeem_points,
        ];
    }
}
