<?php

namespace App\Modules\Customers\Application\Imports;

use App\Modules\Customers\Application\Actions\SaveCustomer;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowErrors;
use App\Modules\Imports\Application\Data\RowResult;
use App\Modules\Imports\Application\Support\BaseImportHandler;
use App\Modules\Imports\Domain\ColumnType;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * ST1: customer import. A row matches a live customer by phone (stored like the customer form
 * does — Bangladeshi mobiles as 01XXXXXXXXX, also when Excel dropped the leading 0), else by
 * e-mail, and updates it (blank cells leave a field unchanged); otherwise SaveCustomer creates
 * one (code "CUS-000001" when blank, audited). Credit limit and opening balance are allowed
 * because the type already needs customers.manage.
 */
final class CustomersImport extends BaseImportHandler
{
    public function __construct(private readonly SaveCustomer $save) {}

    public function type(): string
    {
        return 'customers';
    }

    public function label(): string
    {
        return 'Customers';
    }

    public function permission(): string
    {
        return 'customers.manage';
    }

    public function columns(): array
    {
        return [
            new ImportColumn('name', 'Customer name', true, 'Karim Ahmed', maxLength: 255),
            new ImportColumn('phone', 'Phone', false, '01712345678', 'Mobile number; identifies the customer (a row with the phone of an existing customer updates it). +880 and spaces are fine.', maxLength: 32),
            new ImportColumn('email', 'E-mail', false, 'karim@example.com', 'Identifies the customer when the phone is blank.', maxLength: 255),
            new ImportColumn('address', 'Address', false, 'House 5, Road 2, Dhanmondi, Dhaka', maxLength: 1000),
            new ImportColumn('code', 'Customer code', false, '', 'Optional own code (letters, digits, - _ .). Blank: the next number is given.', maxLength: 30),
            new ImportColumn('tax_number', 'Tax number', false, '', 'BIN / TIN.', maxLength: 64),
            new ImportColumn('credit_limit', 'Credit limit', false, '5000', 'How much the customer may owe (0 = no credit).', ColumnType::Decimal),
            new ImportColumn('opening_balance', 'Opening balance', false, '0', 'Amount the customer owed you when you started (negative: you owed the customer).', ColumnType::Decimal),
            new ImportColumn('notes', 'Notes', false, '', maxLength: 5000),
            new ImportColumn('is_active', 'Active', false, 'yes', 'yes or no (default yes).', ColumnType::Boolean),
        ];
    }

    public function keyOf(array $row): ?string
    {
        $phone = self::phone($row['phone']);
        if ($phone !== null) {
            return 'phone:'.$phone;
        }
        $email = self::fold($row['email']);

        return $email === null ? null : 'email:'.$email;
    }

    public function prepare(array $rows, ImportContext $context): void
    {
        $phones = [];
        $emails = [];
        $codes = [];
        Customer::query()->where('organization_id', $context->organizationId)->orderBy('created_at')
            ->get(['id', 'phone', 'email', 'code'])
            ->each(function (Customer $c) use (&$phones, &$emails, &$codes) {
                if ($c->phone !== null) {
                    $phones[self::phone($c->phone) ?? $c->phone] ??= $c->id;
                }
                if ($c->email !== null) {
                    $emails[mb_strtolower($c->email)] ??= $c->id;
                }
                $codes[mb_strtolower($c->code)] = $c->id;
            });
        $context->put('customers.phones', $phones);
        $context->put('customers.emails', $emails);
        $context->put('customers.codes', $codes);
    }

    public function validateRow(array $row, ImportContext $context): RowResult
    {
        $errors = new RowErrors;
        if ($row['phone'] !== null && preg_match('/^\+?[0-9 ()\-]{5,32}$/', $row['phone']) !== 1) {
            $errors->add('phone', 'Enter a phone number (digits, spaces, + ( ) -).');
        }
        if ($row['email'] !== null && filter_var($row['email'], FILTER_VALIDATE_EMAIL) === false) {
            $errors->add('email', 'Enter a valid e-mail address.');
        }
        foreach (['credit_limit' => 'The credit limit', 'opening_balance' => 'The opening balance'] as $column => $label) {
            if (self::tooPrecise($row[$column], 2)) {
                $errors->add($column, "{$label} has at most 2 decimals.");
            }
        }
        if ($row['credit_limit'] !== null && Decimal::isNegative($row['credit_limit'])) {
            $errors->add('credit_limit', 'The credit limit cannot be negative.');
        }

        $id = $this->existingId($row, $context);
        if ($row['code'] !== null) {
            if (preg_match('/^[A-Za-z0-9\-_.]+$/', $row['code']) !== 1) {
                $errors->add('code', 'Use letters, digits, dashes, dots or underscores.');
            }
            $owner = $context->remember('customers.codes', fn () => [])[mb_strtolower($row['code'])] ?? null;
            if ($owner !== null && $owner !== $id) {
                $errors->add('code', "Code {$row['code']} belongs to another customer.");
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
        $customer = $this->find($row, $context);
        if ($customer !== null && ! $context->updateExisting()) {
            return RowResult::skip();
        }

        $phone = self::phone($row['phone']);
        $attributes = array_filter([
            'name' => $row['name'],
            // An existing customer keeps the phone spelling it was found by.
            'phone' => $customer !== null ? null : $phone,
            'email' => $row['email'],
            'address' => $row['address'],
            'code' => $row['code'] === null ? null : mb_strtoupper($row['code']),
            'tax_number' => $row['tax_number'],
            'credit_limit' => $row['credit_limit'],
            'opening_balance' => $row['opening_balance'],
            'notes' => $row['notes'],
            'is_active' => $row['is_active'],
        ], fn ($v) => $v !== null);

        ($this->save)($customer, $attributes);

        return $customer === null ? RowResult::create() : RowResult::update();
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function existingId(array $row, ImportContext $context): ?string
    {
        $phone = self::phone($row['phone']);
        if ($phone !== null) {
            return $context->remember('customers.phones', fn () => [])[$phone] ?? null;
        }
        $email = self::fold($row['email']);

        return $email === null ? null : ($context->remember('customers.emails', fn () => [])[$email] ?? null);
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function find(array $row, ImportContext $context): ?Customer
    {
        $phone = self::phone($row['phone']);
        $email = self::fold($row['email']);
        if ($phone === null && $email === null) {
            return null;
        }

        $query = Customer::query()->where('organization_id', $context->organizationId)->orderBy('created_at')->lockForUpdate();
        if ($phone !== null) {
            $candidates = array_values(array_unique([$phone, '+88'.$phone, '88'.$phone]));

            return $query->whereIn('phone', $candidates)->first();
        }

        return $query->whereRaw('lower(email) = ?', [$email])->first();
    }

    /**
     * The phone as the customer form stores it (spaces, dashes and brackets removed); a
     * Bangladeshi mobile in its national form 01XXXXXXXXX, also when Excel dropped the 0.
     */
    private static function phone(mixed $raw): ?string
    {
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }
        $mobile = BangladeshMobile::normalize($raw) ?? BangladeshMobile::normalize('0'.$raw);
        if ($mobile !== null) {
            return $mobile;
        }
        $stripped = (string) preg_replace('/[\s()\-]/', '', $raw);

        return $stripped === '' ? null : $stripped;
    }
}
