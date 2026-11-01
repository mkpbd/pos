<?php

namespace App\Modules\Expenses\Application\Actions;

use App\Modules\Expenses\Application\Contracts\ExpenseRecorder;
use App\Modules\Expenses\Domain\EntryType;
use App\Modules\Expenses\Infrastructure\Models\Expense;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * An expense another module's document caused (E10a: the courier fee of a COD remittance).
 * Same entry, numbering and audit as a staff-recorded expense; the payment goes through the
 * ledger without a drawer (PaymentLedger::recordSystem).
 */
class RecordSystemExpense implements ExpenseRecorder
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    public function recordSystemExpense(array $data, ?string $actorId): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $currency = $this->organizations->summary($organizationId)['base_currency'] ?? config('pos.default_currency');
        $amount = Money::of($data['amount'], $currency);
        if (! $amount->isPositive()) {
            throw new InvalidArgumentException('An expense amount must be greater than zero.');
        }
        $clean = fn (string $key) => filled($data[$key] ?? null) ? trim((string) $data[$key]) : null;

        return DB::transaction(function () use ($data, $actorId, $organizationId, $currency, $amount, $clean) {
            $category = $this->category(trim($data['category']), $actorId);
            $expense = Expense::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $data['branch_id'],
                'type' => EntryType::Expense,
                'number' => $this->sequences->next($organizationId, EntryType::Expense->value, EntryType::Expense->prefix()),
                'expense_category_id' => $category->id,
                'currency' => $currency,
                'amount' => $amount->amount(),
                'method' => $data['method'],
                'reference' => $clean('reference'),
                'party' => $clean('party'),
                'occurred_on' => $data['occurred_on'],
                'notes' => $clean('notes'),
                'created_by' => $actorId,
            ]);

            $this->payments->recordSystem($expense->branch_id, [
                new LedgerEntry(EntryType::Expense->direction(), $data['method'], $expense->amount, reference: $expense->reference, description: trim($category->name.' '.($expense->party ?? ''))),
            ], new PaymentSource(EntryType::Expense->value, $expense->id, $expense->number), $actorId);

            $this->audit->record('expense.recorded', $expense, new: [
                'number' => $expense->number,
                'category' => $category->name,
                'amount' => $expense->amount,
                'method' => $data['method']->value,
                'reference' => $expense->reference,
            ]);

            return ['id' => $expense->id, 'number' => $expense->number];
        });
    }

    private function category(string $name, ?string $actorId): ExpenseCategory
    {
        $existing = ExpenseCategory::query()->where('type', EntryType::Expense)->whereRaw('lower(name) = ?', [mb_strtolower($name)])->first();
        if ($existing !== null) {
            return $existing;
        }
        $category = ExpenseCategory::query()->create(['type' => EntryType::Expense, 'name' => $name, 'is_active' => true]);
        $this->audit->record('expense_category.created', $category, new: ['type' => EntryType::Expense->value, 'name' => $name, 'by' => $actorId === null ? 'system' : 'staff']);

        return $category;
    }
}
