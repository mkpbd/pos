<?php

namespace App\Modules\Expenses\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Expenses\Domain\EntryType;
use App\Modules\Expenses\Infrastructure\Models\Expense;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records an expense paid or other income received. The money goes through the payments
 * ledger in the same transaction: cash is paid out of (or into) the recorder's drawer.
 */
class RecordExpense
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly BranchDirectory $branches,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{type: string, branch_id: string, expense_category_id: string, amount: string, method: string, reference?: ?string, party?: ?string, occurred_on: string, notes?: ?string}  $data
     */
    public function __invoke(TenantUser $actor, array $data): Expense
    {
        $organizationId = $this->tenant->requireOrganization();
        $type = EntryType::from($data['type']);
        $category = ExpenseCategory::query()->whereKey($data['expense_category_id'])->where('type', $type)->where('is_active', true)->first()
            ?? throw ValidationException::withMessages(['expense_category_id' => ['The selected category does not exist.']]);
        if (! $this->branches->isActiveBranchOf($data['branch_id'], $organizationId) || ! $actor->canAccessBranch($data['branch_id'])) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist.']]);
        }
        $currency = $this->organizations->summary($organizationId)['base_currency'] ?? config('pos.default_currency');
        $amount = Money::of((string) $data['amount'], $currency);
        if (! $amount->isPositive()) {
            throw ValidationException::withMessages(['amount' => ['The amount must be greater than zero.']]);
        }
        $method = PaymentMethod::from($data['method']);
        $clean = fn (string $key) => filled($data[$key] ?? null) ? trim((string) $data[$key]) : null;

        return DB::transaction(function () use ($actor, $organizationId, $type, $category, $data, $currency, $amount, $method, $clean) {
            $expense = Expense::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $data['branch_id'],
                'type' => $type,
                'number' => $this->sequences->next($organizationId, $type->value, $type->prefix()),
                'expense_category_id' => $category->id,
                'currency' => $currency,
                'amount' => $amount->amount(),
                'method' => $method,
                'reference' => $clean('reference'),
                'party' => $clean('party'),
                'occurred_on' => $data['occurred_on'],
                'notes' => $clean('notes'),
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $this->payments->record($actor, $expense->branch_id, [
                new LedgerEntry($type->direction(), $method, $expense->amount, reference: $expense->reference, description: trim($category->name.' '.($expense->party ?? ''))),
            ], new PaymentSource($type->value, $expense->id, $expense->number));

            $this->audit->record("{$type->value}.recorded", $expense, new: [
                'number' => $expense->number,
                'category' => $category->name,
                'amount' => $expense->amount,
                'method' => $method->value,
            ]);

            return $expense;
        });
    }
}
