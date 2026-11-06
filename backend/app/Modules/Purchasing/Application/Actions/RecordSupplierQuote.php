<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Domain\Procurement\QuoteStatus;
use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Purchasing\Infrastructure\Models\Rfq;
use App\Modules\Purchasing\Infrastructure\Models\RfqLine;
use App\Modules\Purchasing\Infrastructure\Models\RfqSupplier;
use App\Modules\Purchasing\Infrastructure\Models\SupplierQuote;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records an invited supplier's answer to a sent RFQ (SC2): prices per line (any subset of
 * the lines — coverage shows on the comparison), quantity offered, lead time, validity — or
 * a decline. Recording again replaces the supplier's previous answer.
 */
class RecordSupplierQuote
{
    public function __construct(
        private readonly ProductDirectory $products,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{supplier_id: string, status: string, valid_until?: ?string, notes?: ?string, lines?: ?list<array{rfq_line_id: string, unit_price: string, quantity_offered?: ?string, lead_time_days?: ?int, notes?: ?string}>}  $data
     */
    public function __invoke(Rfq $rfq, array $data): SupplierQuote
    {
        return DB::transaction(function () use ($rfq, $data) {
            $locked = Rfq::query()->whereKey($rfq->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== RfqStatus::Sent) {
                throw new BusinessRuleViolation('RFQ_NOT_OPEN', "RFQ {$locked->number} is {$locked->status->value}; quotes can only be recorded while it is sent.", ['status' => $locked->status->value]);
            }
            /** @var RfqSupplier|null $invited */
            $invited = $locked->suppliers()->where('supplier_id', $data['supplier_id'])->first();
            if ($invited === null) {
                throw ValidationException::withMessages(['supplier_id' => ['This supplier was not invited to the RFQ.']]);
            }

            $status = QuoteStatus::from($data['status']);
            $lines = $status === QuoteStatus::Received ? array_values($data['lines'] ?? []) : [];
            if ($status === QuoteStatus::Received) {
                $this->validateLines($locked, $lines);
            }

            $quote = SupplierQuote::query()->where('rfq_supplier_id', $invited->id)->first()
                ?? new SupplierQuote(['organization_id' => $locked->organization_id, 'rfq_supplier_id' => $invited->id]);
            $replacing = $quote->exists;
            $quote->fill([
                'status' => $status,
                'received_at' => now(),
                'valid_until' => $status === QuoteStatus::Received ? ($data['valid_until'] ?? null) : null,
                'notes' => filled($data['notes'] ?? null) ? trim((string) $data['notes']) : null,
            ])->save();

            $quote->lines()->delete();
            foreach ($lines as $line) {
                $quote->lines()->create([
                    'organization_id' => $locked->organization_id,
                    'rfq_line_id' => $line['rfq_line_id'],
                    'unit_price' => Decimal::round((string) $line['unit_price'], 4),
                    'quantity_offered' => ($line['quantity_offered'] ?? null) === null ? null : Decimal::round((string) $line['quantity_offered'], 3),
                    'lead_time_days' => $line['lead_time_days'] ?? null,
                    'notes' => filled($line['notes'] ?? null) ? trim((string) $line['notes']) : null,
                ]);
            }

            $this->audit->record($status === QuoteStatus::Received ? 'rfq.quote_recorded' : 'rfq.quote_declined', $locked, new: [
                'supplier_id' => $invited->supplier_id,
                'lines' => count($lines),
                'replaced' => $replacing,
            ]);

            return $quote;
        });
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function validateLines(Rfq $rfq, array $lines): void
    {
        if ($lines === []) {
            throw ValidationException::withMessages(['lines' => ['Enter a price for at least one line, or record the quote as declined.']]);
        }
        $rfqLines = $rfq->lines()->get()->keyBy('id');
        $variants = $this->products->variants($rfq->organization_id, $rfqLines->pluck('variant_id')->all());
        $errors = [];
        foreach ($lines as $i => $line) {
            /** @var RfqLine|null $rfqLine */
            $rfqLine = $rfqLines->get($line['rfq_line_id']);
            if ($rfqLine === null) {
                $errors["lines.{$i}.rfq_line_id"] = ['This line is not part of the RFQ.'];

                continue;
            }
            $variant = $variants[$rfqLine->variant_id] ?? null;
            $offered = $line['quantity_offered'] ?? null;
            if ($offered !== null && $variant !== null && ! $variant['allow_decimal'] && ! Decimal::isWhole((string) $offered)) {
                $errors["lines.{$i}.quantity_offered"] = ["{$variant['product_name']} is bought in whole units ({$variant['unit_code']})."];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }
}
