<?php

namespace App\Modules\Expenses\Presentation\Http\Exports;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;

/**
 * GET /expenses?export=xlsx|pdf (`type=expense|income`) — expenses or other income.
 */
class ExpensesExport extends ListExport
{
    private bool $income = false;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
    ) {}

    public function forType(?string $type): static
    {
        $this->income = $type === 'income';

        return $this;
    }

    public function name(): string
    {
        return $this->income ? 'income' : 'expenses';
    }

    public function title(): string
    {
        return $this->income ? 'Other income' : 'Expenses';
    }

    public function columns(): array
    {
        return [
            ExportColumn::text('number', 'Number'),
            ExportColumn::date('occurred_on', 'Date'),
            ExportColumn::text('category.name', 'Category'),
            ExportColumn::text('branch.name', 'Branch'),
            ExportColumn::text('party', $this->income ? 'Received from' : 'Paid to'),
            ExportColumn::text('method_label', 'Method'),
            ExportColumn::text('reference', 'Reference'),
            ExportColumn::money('amount', 'Amount'),
            ExportColumn::text('created_by.name', 'Recorded by'),
            ExportColumn::text('void_reason', 'Void reason'),
        ];
    }

    public function filters(Request $request): array
    {
        $org = $this->tenant->requireOrganization();

        return FilterSummary::of($request)
            ->search()
            ->lookup('branch_id', 'Branch', fn (string $id) => $this->branches->profile($id, $org)['name'] ?? null)
            ->lookup('expense_category_id', 'Category', fn (string $id) => ExpenseCategory::query()->whereKey($id)->value('name'))
            ->value('method', 'Method')
            ->flag('voided', 'Voided entries only')
            ->dates()
            ->all();
    }
}
