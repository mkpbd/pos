<?php

namespace App\Modules\Suppliers\Application\Imports;

use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowErrors;
use App\Modules\Imports\Application\Data\RowResult;
use App\Modules\Imports\Application\Support\BaseImportHandler;
use App\Modules\Imports\Domain\ColumnType;
use App\Modules\Suppliers\Application\Actions\SaveSupplier;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;

/**
 * ST1: supplier import. A row matches a live supplier with the same name and phone (digits only;
 * both blank counts as the same) and updates it — blank cells leave a field unchanged — or
 * creates a new supplier through SaveSupplier (code "SUP-0001" when blank, audited).
 */
final class SuppliersImport extends BaseImportHandler
{
    public function __construct(private readonly SaveSupplier $save) {}

    public function type(): string
    {
        return 'suppliers';
    }

    public function label(): string
    {
        return 'Suppliers';
    }

    public function permission(): string
    {
        return 'suppliers.manage';
    }

    public function columns(): array
    {
        return [
            new ImportColumn('name', 'Supplier name', true, 'Pran Foods Ltd', 'Company name. Together with the phone it identifies the supplier: a row with the name and phone of an existing supplier updates it.', maxLength: 255),
            new ImportColumn('contact_person', 'Contact person', false, 'Rahim Uddin', maxLength: 255),
            new ImportColumn('phone', 'Phone', false, '01712345678', 'Phone number.', maxLength: 32),
            new ImportColumn('email', 'E-mail', false, 'orders@pran.example', maxLength: 255),
            new ImportColumn('address', 'Address', false, 'Tejgaon, Dhaka', maxLength: 1000),
            new ImportColumn('code', 'Supplier code', false, 'SUP-0100', 'Optional own code (letters, digits, - _ .). Blank: the next number is given.', maxLength: 30),
            new ImportColumn('tax_number', 'Tax number', false, '', 'BIN / TIN.', maxLength: 64),
            new ImportColumn('payment_terms', 'Payment terms (days)', false, '30', 'Days until an invoice is due (0–365).', ColumnType::Integer),
            new ImportColumn('opening_balance', 'Opening balance', false, '0', 'Amount you owed the supplier when you started (negative: the supplier owed you).', ColumnType::Decimal),
            new ImportColumn('notes', 'Notes', false, '', maxLength: 5000),
            new ImportColumn('is_active', 'Active', false, 'yes', 'yes or no (default yes).', ColumnType::Boolean),
        ];
    }

    public function keyOf(array $row): ?string
    {
        return self::fold($row['name']).'|'.self::digits($row['phone']);
    }

    public function prepare(array $rows, ImportContext $context): void
    {
        $existing = [];
        Supplier::query()->where('organization_id', $context->organizationId)
            ->orderBy('created_at')->get(['id', 'name', 'phone'])
            ->each(function (Supplier $s) use (&$existing) {
                $existing[self::fold($s->name).'|'.self::digits($s->phone)] ??= $s->id;
            });
        $context->put('suppliers.by_key', $existing);
        $context->put('suppliers.codes', Supplier::query()->where('organization_id', $context->organizationId)
            ->get(['id', 'code'])->mapWithKeys(fn (Supplier $s) => [mb_strtolower($s->code) => $s->id])->all());
    }

    public function validateRow(array $row, ImportContext $context): RowResult
    {
        $errors = new RowErrors;
        if ($row['email'] !== null && filter_var($row['email'], FILTER_VALIDATE_EMAIL) === false) {
            $errors->add('email', 'Enter a valid e-mail address.');
        }
        if ($row['payment_terms'] !== null && ((int) $row['payment_terms'] < 0 || (int) $row['payment_terms'] > 365)) {
            $errors->add('payment_terms', 'Payment terms are 0 to 365 days.');
        }
        if (self::tooPrecise($row['opening_balance'], 2)) {
            $errors->add('opening_balance', 'Use at most 2 decimals.');
        }

        $id = $context->remember('suppliers.by_key', fn () => [])[$this->keyOf($row)] ?? null;
        if ($row['code'] !== null) {
            if (preg_match('/^[A-Za-z0-9\-_.]+$/', $row['code']) !== 1) {
                $errors->add('code', 'Use letters, digits, dashes, dots or underscores.');
            }
            $owner = $context->remember('suppliers.codes', fn () => [])[mb_strtolower($row['code'])] ?? null;
            if ($owner !== null && $owner !== $id) {
                $errors->add('code', "Code {$row['code']} belongs to another supplier.");
            }
        }
        if ($errors->any()) {
            return $errors->result();
        }

        return match (true) {
            $id === null => RowResult::create(),
            $context->updateExisting() => RowResult::update(),
            default => RowResult::skip(),
        };
    }

    public function importRow(array $row, ImportContext $context): RowResult
    {
        $supplier = $this->find($context, $row);
        if ($supplier !== null && ! $context->updateExisting()) {
            return RowResult::skip();
        }

        $attributes = array_filter([
            'name' => $row['name'],
            'contact_person' => $row['contact_person'],
            'phone' => $row['phone'],
            'email' => $row['email'],
            'address' => $row['address'],
            'code' => $row['code'] === null ? null : mb_strtoupper($row['code']),
            'tax_number' => $row['tax_number'],
            'payment_terms_days' => $row['payment_terms'] === null ? null : (int) $row['payment_terms'],
            'opening_balance' => $row['opening_balance'],
            'notes' => $row['notes'],
            'is_active' => $row['is_active'],
        ], fn ($v) => $v !== null);

        ($this->save)($supplier, $attributes);

        return $supplier === null ? RowResult::create() : RowResult::update();
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function find(ImportContext $context, array $row): ?Supplier
    {
        $digits = self::digits($row['phone']);

        return Supplier::query()->where('organization_id', $context->organizationId)
            ->whereRaw('lower(name) = ?', [self::fold($row['name'])])
            ->when($digits === '',
                fn ($q) => $q->where(fn ($w) => $w->whereNull('phone')->orWhereRaw("regexp_replace(phone, '[^0-9]', '', 'g') = ''")),
                fn ($q) => $q->whereRaw("regexp_replace(phone, '[^0-9]', '', 'g') = ?", [$digits]))
            ->orderBy('created_at')
            ->lockForUpdate()
            ->first();
    }

    private static function digits(mixed $phone): string
    {
        return is_string($phone) ? (string) preg_replace('/\D+/', '', $phone) : '';
    }
}
