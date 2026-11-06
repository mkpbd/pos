<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Purchasing\Application\Services\ApprovalRules;
use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisition;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;

/**
 * "Waiting for my approval" (SC2): submitted requisitions and purchase orders pending
 * approval in the user's branches, at levels the user may approve, that the user did not
 * raise or submit — oldest submission first.
 */
class ApprovalInbox
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly ApprovalRules $rules,
        private readonly BranchDirectory $branches,
        private readonly SupplierDirectory $suppliers,
        private readonly UserDirectory $users,
    ) {}

    /**
     * @param  array{kind?: ?string, approval_level?: ?string, search?: ?string}  $filters
     * @return list<array<string, mixed>>
     */
    public function for(TenantUser $user, array $filters = []): array
    {
        $org = $this->tenant->requireOrganization();
        $levels = array_map(fn (ApprovalLevel $l) => $l->value, $this->rules->approvableLevels($user));
        if (($filters['approval_level'] ?? null) !== null) {
            $levels = array_values(array_intersect($levels, [$filters['approval_level']]));
        }
        if ($levels === []) {
            return [];
        }
        $me = (string) $user->getAuthIdentifier();
        $branches = $user->accessibleBranchIds();
        $search = trim((string) ($filters['search'] ?? ''));
        $scope = function (Builder $q) use ($branches, $levels, $search) {
            $q->whereIn('approval_level', $levels)
                ->when($branches !== null, fn (Builder $b) => $b->whereIn('branch_id', $branches))
                ->when($search !== '', fn (Builder $b) => $b->whereLike('number', '%'.addcslashes($search, '%_\\').'%'));
        };

        $kind = $filters['kind'] ?? null;
        $requisitions = $kind === 'purchase_order' ? collect() : PurchaseRequisition::query()
            ->where('status', RequisitionStatus::Submitted->value)
            ->where('requested_by', '!=', $me)
            ->tap($scope)
            ->withCount('lines')
            ->get();
        $orders = $kind === 'requisition' ? collect() : PurchaseOrder::query()
            ->where('status', PurchaseOrderStatus::PendingApproval->value)
            ->where(fn (Builder $q) => $q->whereNull('created_by')->orWhere('created_by', '!=', $me))
            ->where(fn (Builder $q) => $q->whereNull('submitted_by')->orWhere('submitted_by', '!=', $me))
            ->tap($scope)
            ->withCount('lines')
            ->get();

        $stores = $this->branches->storeSummaries($org, [...$requisitions->pluck('store_id')->all(), ...$orders->pluck('store_id')->all()]);
        $names = $this->users->names($org, array_values(array_filter([...$requisitions->pluck('requested_by')->all(), ...$orders->pluck('submitted_by')->all(), ...$orders->pluck('created_by')->all()])));
        $suppliers = $this->suppliers->summaries($org, $orders->pluck('supplier_id')->all());
        $person = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];
        $branch = fn (?array $store, string $branchId) => $store === null ? ['id' => $branchId, 'name' => null] : ['id' => $store['branch_id'], 'name' => $store['branch_name']];

        $rows = [];
        foreach ($requisitions as $r) {
            $store = $stores[$r->store_id] ?? null;
            $rows[] = [
                'kind' => 'requisition',
                'id' => $r->id,
                'number' => $r->number,
                'status' => $r->status->value,
                'amount' => $r->estimated_total,
                'currency' => $r->currency,
                'approval_level' => $r->approval_level?->value,
                'approver_permission' => $r->approval_level?->requiredPermission(),
                'requested_by' => $person($r->requested_by),
                'submitted_at' => $r->submitted_at?->toIso8601String(),
                'needed_by' => $r->needed_by?->toDateString(),
                'branch' => $branch($store, $r->branch_id),
                'store' => $store,
                'supplier' => null,
                'line_count' => (int) $r->lines_count,
                'link' => '/purchasing/requisitions/'.$r->id,
            ];
        }
        foreach ($orders as $o) {
            $store = $stores[$o->store_id] ?? null;
            $rows[] = [
                'kind' => 'purchase_order',
                'id' => $o->id,
                'number' => $o->number,
                'status' => $o->status->value,
                'amount' => $o->total,
                'currency' => $o->currency,
                'approval_level' => $o->approval_level?->value,
                'approver_permission' => $o->approval_level?->requiredPermission(),
                'requested_by' => $person($o->submitted_by ?? $o->created_by),
                'submitted_at' => $o->submitted_at?->toIso8601String(),
                'needed_by' => $o->expected_date?->toDateString(),
                'branch' => $branch($store, $o->branch_id),
                'store' => $store,
                'supplier' => $suppliers[$o->supplier_id] ?? null,
                'line_count' => (int) $o->lines_count,
                'link' => '/purchasing/orders/'.$o->id,
            ];
        }
        usort($rows, fn (array $a, array $b) => [$a['submitted_at'] ?? '', $a['number']] <=> [$b['submitted_at'] ?? '', $b['number']]);

        return $rows;
    }
}
