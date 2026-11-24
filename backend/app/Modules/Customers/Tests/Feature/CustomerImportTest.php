<?php

namespace App\Modules\Customers\Tests\Feature;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Imports\Tests\Concerns\UploadsImports;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ST1: customer import — phone (Bangladeshi mobile form) else e-mail as the key, opening balances.
 */
class CustomerImportTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase, UploadsImports;

    private const HEADER = ['name', 'phone', 'email', 'address', 'credit_limit', 'opening_balance', 'notes'];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_creates_and_updates_customers_by_phone_or_email(): void
    {
        ['admin' => $admin, 'branch' => $branch, 'organization' => $org] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($otherAdmin);
        $this->postJson('/api/v1/customers', ['name' => 'Foreign', 'phone' => '01711000009'])->assertCreated();
        $this->actingAsUser($admin);
        $this->postJson('/api/v1/customers', ['name' => 'Karim', 'phone' => '01711000001', 'notes' => 'VIP'])->assertCreated();
        $this->postJson('/api/v1/customers', ['name' => 'Mail only', 'email' => 'mail@example.com'])->assertCreated();

        $import = $this->importNow('customers', $this->xlsxFile([
            self::HEADER,
            ['Karim Ahmed', '+880 1711-000001', null, 'Dhanmondi', 5000, null, null],   // update by phone
            ['Mail Only Ltd', null, 'MAIL@example.com', null, null, '-20.5', null],    // update by e-mail
            ['Rahima', 1711000002, null, null, null, '150', null],                     // Excel dropped the 0
            ['Foreign twin', '01711000009', null, null, null, null, null],             // another org's phone: new
            ['Dup', '01711000002', null, null, null, null, null],                      // duplicate of row 4
        ]));
        $this->assertSame([2, 2, 1], [$import['created'], $import['updated'], $import['rows_error']]);

        $karim = Customer::query()->where('phone', '01711000001')->firstOrFail();
        $this->assertSame(['Karim Ahmed', 'Dhanmondi', '5000.00', 'VIP'], [$karim->name, $karim->address, $karim->credit_limit, $karim->notes]);
        $this->assertSame('-20.50', Customer::query()->whereRaw('lower(email) = ?', ['mail@example.com'])->value('opening_balance'));
        $this->assertSame('150.00', Customer::query()->where('phone', '01711000002')->value('opening_balance'));
        $this->assertTrue(Customer::query()->where('phone', '01711000009')->where('name', 'Foreign twin')->exists());
        $this->assertDatabaseHas('audit_logs', ['action' => 'customer.updated', 'subject_id' => $karim->id]);

        // customers.create alone (cashier) is not enough to import.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->upload('customers', $this->csvFile([self::HEADER]))->assertForbidden();
    }

    public function test_invalid_cells_are_reported(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $errors = collect($this->upload('customers', $this->csvFile([
            self::HEADER,
            ['A', 'abc', 'not-mail', '', '-1', '1.234', ''],
            ['', '01711000003', '', '', '', '', ''],
        ]))->assertCreated()->json('data.errors'));
        $this->assertEqualsCanonicalizing([[2, 'phone'], [2, 'email'], [2, 'credit_limit'], [2, 'opening_balance'], [3, 'name']], $errors->map(fn ($e) => [$e['row'], $e['column']])->all());
    }
}
