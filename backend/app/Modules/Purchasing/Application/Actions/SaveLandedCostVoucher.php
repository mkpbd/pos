<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostVoucherStatus;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucher;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucherCharge;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucherReceipt;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * SC3: drafts of landed cost vouchers — create, replace (draft only) and delete (draft only).
 * The voucher belongs to one branch; its receipts must be goods receipts of that branch; the
 * charge supplier (who bills the charges) is required and must be active. Totals are computed
 * here. Numbers (`LCV-000001`) are taken when the draft is created.
 */
class SaveLandedCostVoucher
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly BranchDirectory $branches,
        private readonly OrganizationDate $dates,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{branch_id: string, voucher_date: string, charge_supplier_id: string, reference?: ?string, notes?: ?string, charges: list<array<string, mixed>>, receipt_ids: list<string>}  $data
     */
    public function save(TenantUser $actor, ?LandedCostVoucher $voucher, array $data): LandedCostVoucher
    {
        if ($voucher !== null) {
            $this->assertVisible($actor, $voucher);
        }
        $draft = $this->validated($actor, $data);
        $organizationId = $this->context->organizationId();
        $currency = $this->context->currency();
        $totals = self::totals($draft['charges'], $currency);

        return DB::transaction(function () use ($actor, $voucher, $draft, $organizationId, $currency, $totals) {
            if ($voucher !== null) {
                $voucher = $this->lockDraft($voucher);
            }
            $creating = $voucher === null;
            $voucher ??= new LandedCostVoucher([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'landed_cost_voucher', 'LCV-'),
                'status' => LandedCostVoucherStatus::Draft,
                'created_by' => (string) $actor->getAuthIdentifier(),
            ]);

            $voucher->fill([
                'branch_id' => $draft['branch_id'],
                'voucher_date' => $draft['voucher_date'],
                'charge_supplier_id' => $draft['charge_supplier_id'],
                'reference' => $draft['reference'],
                'notes' => $draft['notes'],
                'currency' => $currency,
                'charges_total' => $totals['charges_total'],
                'tax_total' => $totals['tax_total'],
                'total' => $totals['total'],
                'updated_by' => (string) $actor->getAuthIdentifier(),
            ])->save();

            $this->clear($voucher);
            foreach ($draft['charges'] as $i => $charge) {
                $voucher->charges()->create(['organization_id' => $organizationId, 'sort_order' => $i] + $charge);
            }
            foreach ($draft['receipts'] as $i => $receipt) {
                $voucher->receipts()->create(['organization_id' => $organizationId, 'goods_receipt_id' => $receipt->id, 'sort_order' => $i]);
            }

            $this->audit->record($creating ? 'landed_cost_voucher.created' : 'landed_cost_voucher.updated', $voucher, new: [
                'number' => $voucher->number,
                'charge_supplier_id' => $voucher->charge_supplier_id,
                'total' => $voucher->total,
                'receipts' => $draft['receipts']->pluck('number')->all(),
            ]);

            return $voucher;
        });
    }

    public function delete(TenantUser $actor, LandedCostVoucher $voucher): void
    {
        $this->assertVisible($actor, $voucher);

        DB::transaction(function () use ($voucher) {
            $locked = $this->lockDraft($voucher);
            $this->audit->record('landed_cost_voucher.deleted', $locked, old: ['number' => $locked->number, 'total' => $locked->total]);
            $this->clear($locked);
            $locked->delete();
        });
    }

    private function clear(LandedCostVoucher $voucher): void
    {
        LandedCostVoucherCharge::query()->where('landed_cost_voucher_id', $voucher->id)->delete();
        LandedCostVoucherReceipt::query()->where('landed_cost_voucher_id', $voucher->id)->delete();
    }

    /**
     * Shape and business checks shared with the preview.
     *
     * @param  array<string, mixed>  $data
     * @return array{branch_id: string, voucher_date: string, charge_supplier_id: string, reference: ?string, notes: ?string, charges: list<array{type: string, description: ?string, amount: string, tax_amount: string, allocation: string}>, receipts: Collection<int, GoodsReceipt>}
     */
    public function validated(TenantUser $actor, array $data): array
    {
        $organizationId = $this->context->organizationId();
        $errors = [];
        if (! $actor->canAccessBranch($data['branch_id']) || ! $this->branches->isActiveBranchOf($data['branch_id'], $organizationId)) {
            $errors['branch_id'] = ['The selected branch does not exist.'];
        }
        if ($data['voucher_date'] > $this->dates->today()) {
            $errors['voucher_date'] = ['The voucher date cannot be in the future.'];
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        $this->context->requireActiveSupplier($data['charge_supplier_id'], 'charge_supplier_id');

        $ids = array_values($data['receipt_ids']);
        $found = GoodsReceipt::query()->whereKey($ids)->get()->keyBy('id');
        $receipts = collect();
        foreach ($ids as $i => $id) {
            $receipt = $found[$id] ?? null;
            if ($receipt === null || $receipt->branch_id !== $data['branch_id']) {
                $errors["receipt_ids.{$i}"] = ['Choose a goods receipt of the voucher\'s branch.'];

                continue;
            }
            $receipts->push($receipt);
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return [
            'branch_id' => $data['branch_id'],
            'voucher_date' => $data['voucher_date'],
            'charge_supplier_id' => $data['charge_supplier_id'],
            'reference' => filled($data['reference'] ?? null) ? trim((string) $data['reference']) : null,
            'notes' => filled($data['notes'] ?? null) ? trim((string) $data['notes']) : null,
            'charges' => array_map(fn (array $c) => [
                'type' => (string) $c['type'],
                'description' => filled($c['description'] ?? null) ? trim((string) $c['description']) : null,
                'amount' => Decimal::round((string) $c['amount'], 2),
                'tax_amount' => Decimal::round((string) ($c['tax_amount'] ?? '0'), 2),
                'allocation' => (string) $c['allocation'],
            ], array_values($data['charges'])),
            'receipts' => $receipts,
        ];
    }

    /**
     * @param  list<array{amount: string, tax_amount: string}>  $charges
     * @return array{charges_total: string, tax_total: string, total: string}
     */
    public static function totals(array $charges, string $currency): array
    {
        $amount = Money::zero($currency);
        $tax = Money::zero($currency);
        foreach ($charges as $charge) {
            $amount = $amount->plus(Money::of($charge['amount'], $currency));
            $tax = $tax->plus(Money::of($charge['tax_amount'], $currency));
        }

        return ['charges_total' => $amount->amount(), 'tax_total' => $tax->amount(), 'total' => $amount->plus($tax)->amount()];
    }

    private function lockDraft(LandedCostVoucher $voucher): LandedCostVoucher
    {
        /** @var LandedCostVoucher $locked */
        $locked = LandedCostVoucher::query()->whereKey($voucher->id)->lockForUpdate()->firstOrFail();
        if ($locked->status !== LandedCostVoucherStatus::Draft) {
            throw new BusinessRuleViolation('LANDED_COST_VOUCHER_LOCKED', "Landed cost voucher {$locked->number} is {$locked->status->value} and can no longer be changed.");
        }

        return $locked;
    }

    private function assertVisible(TenantUser $actor, LandedCostVoucher $voucher): void
    {
        if (! $actor->canAccessBranch($voucher->branch_id)) {
            throw new NotFoundHttpException;
        }
    }
}
