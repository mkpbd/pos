<?php

namespace App\Modules\Suppliers\Tests\Feature;

use App\Modules\Imports\Tests\Concerns\UploadsImports;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ST1: supplier import — name + phone as the key, payment terms and opening balance.
 */
class SupplierImportTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase, UploadsImports;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_creates_updates_and_reports_suppliers(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($otherAdmin);
        $this->postJson('/api/v1/suppliers', ['name' => 'Pran Foods', 'phone' => '01711000001'])->assertCreated();
        $this->actingAsUser($admin);
        $this->postJson('/api/v1/suppliers', ['name' => 'ACI', 'phone' => '+880 1711 000002', 'payment_terms_days' => 7])->assertCreated();

        $import = $this->importNow('suppliers', $this->csvFile([
            ['name', 'contact_person', 'phone', 'email', 'payment_terms', 'opening_balance', 'is_active'],
            ['Pran Foods', 'Rahim', '01711000001', 'orders@pran.test', '30', '2500', 'yes'],  // the other org's supplier: new here
            ['aci', '', '8801711000002', '', '15', '', ''],                                    // same digits: update
            ['Square', '', '', 'bad', '400', '1.234', 'perhaps'],                               // errors
        ]));
        $this->assertSame([1, 1, 1], [$import['created'], $import['updated'], $import['rows_error']]);

        $pran = Supplier::query()->where('organization_id', $org->id)->where('name', 'Pran Foods')->firstOrFail();
        $this->assertSame(['Rahim', 30, '2500.00', true], [$pran->contact_person, $pran->payment_terms_days, $pran->opening_balance, $pran->is_active]);
        $this->assertSame(15, Supplier::query()->whereRaw('lower(name) = ?', ['aci'])->firstOrFail()->payment_terms_days);
        $this->assertSame(2, Supplier::query()->where('organization_id', $org->id)->count());

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]));
        $this->upload('suppliers', $this->csvFile([['name'], ['X']]))->assertForbidden();
    }
}
