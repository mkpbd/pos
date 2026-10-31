<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Sales\Application\Services\CartPricer;
use App\Modules\Sales\Application\Services\CustomerCredit;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Sales\Domain\PaymentSettlement;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Infrastructure\Models\SaleLineSerial;
use App\Modules\Sales\Infrastructure\Models\SaleLineStock;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Critical workflows #8 and #9: successful checkout and inventory deduction.
 *
 * Prices the cart on the server (CartPricer), settles the payments, and then — in one
 * transaction — numbers the invoice, deducts stock through the ledger (FEFO batches,
 * INSUFFICIENT_STOCK unless the branch allows negative stock), and writes the immutable
 * invoice with its cost snapshot, batch allocations, serial numbers and payments.
 * Any failure rolls everything back. Idempotency is enforced by the calling endpoint.
 */
class CompleteSale
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly StoreAccess $storeAccess,
        private readonly CartPricer $pricer,
        private readonly CustomerCredit $credit,
        private readonly StockLedger $ledger,
        private readonly SequenceGenerator $sequences,
    ) {}

    /**
     * @param  array{store_id: string, customer_id?: ?string, lines: list<array{variant_id: string, quantity: string, discount?: ?array{type: string, value: string}, serials?: ?list<string>}>, invoice_discount?: ?array{type: string, value: string}, notes?: ?string, payments: list<array{method: string, amount: string, reference?: ?string}>}  $data
     *
     * @throws ValidationException|BusinessRuleViolation
     */
    public function __invoke(TenantUser $actor, array $data): Sale
    {
        $organizationId = $this->context->organizationId();
        $store = $this->storeAccess->require($actor, $data['store_id']);
        [$priced, $variants, $customer] = $this->pricer->priceForCheckout($actor, $store, $data);
        $lines = array_values($data['lines']);
        $serials = $this->serials($organizationId, $lines, $variants);

        $currency = $priced['currency'];
        $settlement = PaymentSettlement::settle(Money::of($priced['total'], $currency), array_map(fn (array $p) => [
            'method' => PaymentMethod::from($p['method']),
            'amount' => (string) $p['amount'],
            'reference' => filled($p['reference'] ?? null) ? trim($p['reference']) : null,
        ], $data['payments'] ?? []));

        $hasDue = Decimal::compare($settlement['due'], '0') > 0;
        if ($hasDue && $customer === null) {
            throw new BusinessRuleViolation('CUSTOMER_REQUIRED', 'Choose a customer to leave an amount due; walk-in sales must be paid in full.', ['due' => $settlement['due']]);
        }
        if ($hasDue && ! Gate::forUser($actor)->allows('sales.credit')) {
            throw new BusinessRuleViolation('CREDIT_SALE_NOT_ALLOWED', 'You are not allowed to sell on credit; collect the full amount.', ['due' => $settlement['due']]);
        }

        return DB::transaction(function () use ($actor, $organizationId, $store, $priced, $variants, $customer, $serials, $settlement, $hasDue, $data) {
            if ($hasDue) {
                $this->assertCredit($customer, $settlement['due']);
            }

            $saleId = (string) Str::uuid7();
            $number = $this->sequences->next($organizationId, "sale:{$store['branch_id']}", $this->context->invoicePrefix().$store['branch_code'].'-');
            $now = now();

            $changes = [];
            foreach ($priced['lines'] as $i => $line) {
                if ($line['track_stock']) {
                    $changes[$i] = new StockChange($store['id'], $line['variant_id'], null, MovementType::Sale, $line['quantity'], allocateBatches: true);
                }
            }
            $posted = $this->ledger->post(array_values($changes), new StockReference('sale', $saleId, $number));
            $stock = array_combine(array_keys($changes), $posted);

            $costs = [];
            foreach ($priced['lines'] as $i => $line) {
                $unitCost = isset($stock[$i]) ? $stock[$i]['unit_cost'] : Decimal::round($variants[$line['variant_id']]['purchase_price'], 4);
                $costs[$i] = ['unit_cost' => $unitCost, 'cost_total' => Money::ofProduct($line['quantity'], $unitCost, $priced['currency'])];
            }

            $sale = Sale::query()->create([
                'id' => $saleId,
                'organization_id' => $organizationId,
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'number' => $number,
                'customer_id' => $customer['id'] ?? null,
                'status' => SaleStatus::Completed,
                'tax_mode' => $priced['tax_mode'],
                'currency' => $priced['currency'],
                'subtotal' => $priced['subtotal'],
                'item_discount_total' => $priced['item_discount_total'],
                'invoice_discount_type' => $priced['invoice_discount']['type'] ?? null,
                'invoice_discount_value' => $priced['invoice_discount']['value'] ?? null,
                'invoice_discount_source' => $priced['invoice_discount']['source'] ?? null,
                'invoice_discount_total' => $priced['invoice_discount_total'],
                'tax_total' => $priced['tax_total'],
                'total' => $priced['total'],
                'paid_total' => $settlement['paid_total'],
                'change_total' => $settlement['change'],
                'due_total' => $settlement['due'],
                'cost_total' => array_reduce($costs, fn (Money $sum, array $c) => $sum->plus($c['cost_total']), Money::zero($priced['currency']))->amount(),
                'notes' => filled($data['notes'] ?? null) ? trim($data['notes']) : null,
                'sold_at' => $now,
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            foreach ($priced['lines'] as $i => $line) {
                $saleLine = SaleLine::query()->create([
                    'organization_id' => $organizationId,
                    'sale_id' => $sale->id,
                    'position' => $i,
                    'variant_id' => $line['variant_id'],
                    'product_name' => $line['product_name'],
                    'variant_name' => $line['variant_name'],
                    'sku' => $line['sku'],
                    'unit_code' => $line['unit_code'],
                    'quantity' => $line['quantity'],
                    'unit_price' => $line['unit_price'],
                    'discount_type' => $line['discount']['type'] ?? null,
                    'discount_value' => $line['discount']['value'] ?? null,
                    'line_subtotal' => $line['line_subtotal'],
                    'discount_amount' => $line['discount_amount'],
                    'invoice_discount_share' => $line['invoice_discount_share'],
                    'net_amount' => $line['net_amount'],
                    'tax_rate' => $line['tax_rate'],
                    'tax_amount' => $line['tax_amount'],
                    'line_total' => $line['line_total'],
                    'unit_cost' => $costs[$i]['unit_cost'],
                    'cost_total' => $costs[$i]['cost_total']->amount(),
                    'created_at' => $now,
                ]);

                foreach ($stock[$i]['allocations'] ?? [] as $allocation) {
                    SaleLineStock::query()->create([
                        'organization_id' => $organizationId,
                        'sale_line_id' => $saleLine->id,
                        'batch_id' => $allocation['batch_id'],
                        'quantity' => $allocation['quantity'],
                        'unit_cost' => $allocation['unit_cost'],
                    ]);
                }
                foreach ($serials[$i] ?? [] as $serial) {
                    SaleLineSerial::query()->create([
                        'organization_id' => $organizationId,
                        'sale_line_id' => $saleLine->id,
                        'variant_id' => $line['variant_id'],
                        'serial' => $serial,
                    ]);
                }
            }

            foreach ($settlement['payments'] as $payment) {
                SalePayment::query()->create([
                    'organization_id' => $organizationId,
                    'sale_id' => $sale->id,
                    'branch_id' => $store['branch_id'],
                    'kind' => 'payment',
                    'method' => $payment['method'],
                    'amount' => $payment['amount'],
                    'tendered' => $payment['tendered'],
                    'reference' => $payment['reference'],
                    'created_by' => $actor->getAuthIdentifier(),
                    'created_at' => $now,
                ]);
            }

            return $sale;
        });
    }

    /**
     * @param  array<string, mixed>  $customer
     */
    private function assertCredit(array $customer, string $due): void
    {
        $this->credit->lock($customer['id']);
        $position = $this->credit->position($customer);

        if (Decimal::compare(Decimal::add($position['outstanding'], $due, 2), $position['credit_limit']) > 0) {
            throw new BusinessRuleViolation('CREDIT_LIMIT_EXCEEDED', "{$customer['name']} can owe at most {$position['credit_limit']}; {$position['outstanding']} is already outstanding.", [
                'credit_limit' => $position['credit_limit'],
                'outstanding' => $position['outstanding'],
                'available' => $position['available'],
                'due' => $due,
            ]);
        }
    }

    /**
     * Serial numbers for serial-tracked products: one per unit, unique, and not already sold.
     *
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, array<string, mixed>>  $variants
     * @return array<int, list<string>>
     *
     * @throws ValidationException
     */
    private function serials(string $organizationId, array $lines, array $variants): array
    {
        $errors = [];
        $result = [];
        $seen = [];

        foreach ($lines as $i => $line) {
            $variant = $variants[$line['variant_id']];
            $given = array_values(array_filter(array_map(fn ($s) => trim((string) $s), $line['serials'] ?? []), fn (string $s) => $s !== ''));

            if (! $variant['track_serials']) {
                if ($given !== []) {
                    $errors["lines.{$i}.serials"] = ["{$variant['product_name']} does not track serial numbers."];
                }

                continue;
            }

            $quantity = Decimal::round((string) $line['quantity'], 3);
            if (! Decimal::isWhole($quantity) || count($given) !== (int) Decimal::round($quantity, 0)) {
                $errors["lines.{$i}.serials"] = ["Scan one serial number per unit of {$variant['product_name']} (".Decimal::round($quantity, 0).' needed).'];

                continue;
            }
            foreach ($given as $serial) {
                $key = $variant['variant_id'].'|'.mb_strtolower($serial);
                if (isset($seen[$key])) {
                    $errors["lines.{$i}.serials"] = ["Serial {$serial} is entered twice."];
                }
                $seen[$key] = true;
            }
            $result[$i] = $given;
        }

        foreach ($result as $i => $given) {
            $sold = SaleLineSerial::query()
                ->where('organization_id', $organizationId)
                ->where('variant_id', $lines[$i]['variant_id'])
                ->whereNull('released_at')
                ->whereIn(DB::raw('lower(serial)'), array_map(mb_strtolower(...), $given))
                ->pluck('serial')
                ->all();
            if ($sold !== []) {
                $errors["lines.{$i}.serials"] = ['Already sold: '.implode(', ', $sold).'.'];
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $result;
    }
}
