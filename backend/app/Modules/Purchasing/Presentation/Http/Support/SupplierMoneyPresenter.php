<?php

namespace App\Modules\Purchasing\Presentation\Http\Support;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Purchasing\Infrastructure\Models\SupplierRefund;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;

/**
 * Shapes supplier payments and refunds (ST1: branch, void marker, user names), with the
 * names looked up once per page.
 */
class SupplierMoneyPresenter
{
    private const METHOD_LABELS = [
        'cash' => 'Cash',
        'bank_transfer' => 'Bank transfer',
        'mobile_banking' => 'Mobile banking',
        'cheque' => 'Cheque',
        'card' => 'Card',
        'other' => 'Other',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SupplierDirectory $suppliers,
        private readonly BranchDirectory $branches,
        private readonly UserDirectory $users,
    ) {}

    /**
     * @param  Collection<int, SupplierPayment|SupplierRefund>  $documents
     * @return callable(SupplierPayment|SupplierRefund): array<string, mixed>
     */
    public function presenter(Collection $documents): callable
    {
        $org = $this->tenant->requireOrganization();
        $suppliers = $this->suppliers->summaries($org, $documents->pluck('supplier_id')->unique()->values()->all());
        $branches = collect($this->branches->summaries($org, $documents->pluck('branch_id')->filter()->unique()->values()->all()))->keyBy('id');
        $users = $this->users->names($org, $documents->flatMap(fn ($d) => [$d->created_by, $d->voided_by])->filter()->unique()->values()->all());
        $user = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $users[$id] ?? null];

        return function (SupplierPayment|SupplierRefund $d) use ($suppliers, $branches, $user) {
            $date = $d instanceof SupplierPayment ? ['paid_on' => $d->paid_on->toDateString()] : ['received_on' => $d->received_on->toDateString()];

            return [
                'id' => $d->id,
                'number' => $d->number,
                'supplier' => $suppliers[$d->supplier_id] ?? null,
                'branch_id' => $d->branch_id,
                'branch' => $d->branch_id !== null && isset($branches[$d->branch_id]) ? ['id' => $d->branch_id, 'name' => $branches[$d->branch_id]['name']] : null,
                'currency' => $d->currency,
                'amount' => $d->amount,
                'method' => $d->method->value,
                'method_label' => self::METHOD_LABELS[$d->method->value] ?? $d->method->value,
                'reference' => $d->reference,
                ...$date,
                'notes' => $d->notes,
                // Kept as the id for compatibility; `created_by_user` carries the name.
                'created_by' => $d->created_by,
                'created_by_user' => $user($d->created_by),
                'created_at' => $d->created_at?->toIso8601String(),
                'voided_at' => $d->voided_at?->toIso8601String(),
                'voided_by' => $user($d->voided_by),
                'void_reason' => $d->void_reason,
            ];
        };
    }
}
