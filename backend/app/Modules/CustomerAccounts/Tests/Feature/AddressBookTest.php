<?php

namespace App\Modules\CustomerAccounts\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class AddressBookTest extends TestCase
{
    use ActsAsShopper, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const URL = 'http://shop.example.test/api/v1/store/account/addresses';

    private int $dhakaDivision;

    private int $dhakaDistrict;

    private int $gazipur;

    private int $sylhetDistrict;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->openStore('Berry Kids', 'shop.example.test');
        $this->asVisitor();
        $this->dhakaDivision = (int) DB::table('geo_divisions')->where('name_en', 'Dhaka')->value('id');
        $this->dhakaDistrict = (int) DB::table('geo_districts')->where('name_en', 'Dhaka')->value('id');
        $this->gazipur = (int) DB::table('geo_districts')->where('name_en', 'Gazipur')->value('id');
        $this->sylhetDistrict = (int) DB::table('geo_districts')->where('name_en', 'Sylhet')->value('id');
    }

    /**
     * @return array<string, mixed>
     */
    private function address(array $overrides = []): array
    {
        return $overrides + [
            'label' => 'Home',
            'recipient_name' => 'Rina Akter',
            'phone' => '+88 01712-345678',
            'division_id' => $this->dhakaDivision,
            'district_id' => $this->dhakaDistrict,
            'area' => 'Dhanmondi',
            'address_line' => 'House 12, Road 5',
            'postcode' => '1205',
        ];
    }

    public function test_geography_reference_data_is_public_and_cacheable(): void
    {
        $divisions = $this->getJson('http://shop.example.test/api/v1/store/geo/divisions')->assertOk()
            ->assertHeader('Cache-Control', 'max-age=86400, public');
        $this->assertCount(8, $divisions->json('data'));
        $this->assertSame(['Barishal', 'Chattogram', 'Dhaka', 'Khulna', 'Mymensingh', 'Rajshahi', 'Rangpur', 'Sylhet'], array_column($divisions->json('data'), 'name'));
        $this->assertSame('ঢাকা', collect($divisions->json('data'))->firstWhere('name', 'Dhaka')['name_bn']);

        $this->assertCount(64, $this->getJson('http://shop.example.test/api/v1/store/geo/districts')->assertOk()->json('data'));
        $dhaka = $this->getJson("http://shop.example.test/api/v1/store/geo/districts?division={$this->dhakaDivision}")->assertOk()->json('data');
        $this->assertCount(13, $dhaka);
        $this->assertSame(['id' => $this->gazipur, 'division_id' => $this->dhakaDivision, 'name' => 'Gazipur', 'name_bn' => 'গাজীপুর'], collect($dhaka)->firstWhere('name', 'Gazipur'));
        $this->getJson('http://shop.example.test/api/v1/store/geo/districts?division=abc')->assertStatus(422);
        // Every division has districts; 64 in total across 8.
        $this->assertSame(64, DB::table('geo_districts')->distinct()->count('code'));
    }

    public function test_addresses_need_a_signed_in_customer(): void
    {
        $this->browse('GET', self::URL)->assertUnauthorized();
        $this->browse('POST', self::URL, $this->address())->assertUnauthorized();
    }

    public function test_create_normalizes_the_phone_and_checks_the_district(): void
    {
        $this->registerShopper('shop.example.test');

        $created = $this->browse('POST', self::URL, $this->address())->assertCreated()->json('data');
        $this->assertSame('01712345678', $created['phone']);
        $this->assertSame(['id' => $this->dhakaDivision, 'name' => 'Dhaka'], $created['division']);
        $this->assertSame(['id' => $this->dhakaDistrict, 'name' => 'Dhaka'], $created['district']);
        $this->assertTrue($created['is_default_shipping']);
        $this->assertTrue($created['is_default_billing']);
        $this->assertSame(['id', 'label', 'recipient_name', 'phone', 'division', 'district', 'area', 'address_line', 'postcode', 'is_default_shipping', 'is_default_billing'], array_keys($created));

        $this->browse('POST', self::URL, $this->address(['district_id' => $this->sylhetDistrict]))
            ->assertStatus(422)->assertJsonValidationErrors(['district_id'], 'error.details');
        $this->browse('POST', self::URL, $this->address(['phone' => '0171234567']))
            ->assertStatus(422)->assertJsonValidationErrors(['phone'], 'error.details');
        $this->browse('POST', self::URL, $this->address(['phone' => '01212345678', 'postcode' => '12']))
            ->assertStatus(422)->assertJsonValidationErrors(['phone', 'postcode'], 'error.details');
        $this->browse('POST', self::URL, $this->address(['division_id' => 99]))
            ->assertStatus(422)->assertJsonValidationErrors(['division_id'], 'error.details');

        $this->browse('PATCH', self::URL.'/'.$created['id'], ['district_id' => $this->gazipur, 'phone' => '8801912345678'])->assertOk()
            ->assertJsonPath('data.district.name', 'Gazipur')->assertJsonPath('data.phone', '01912345678')->assertJsonPath('data.area', 'Dhanmondi');
        $this->browse('PATCH', self::URL.'/'.$created['id'], ['district_id' => $this->sylhetDistrict])->assertStatus(422);

        // Blank optional fields arrive as null.
        $this->browse('POST', self::URL, $this->address(['label' => null, 'postcode' => null, 'phone' => '01712345678']))->assertCreated()
            ->assertJsonPath('data.label', null)->assertJsonPath('data.postcode', null);
    }

    public function test_exactly_one_default_shipping_address(): void
    {
        $this->registerShopper('shop.example.test');

        $home = $this->browse('POST', self::URL, $this->address(['label' => 'Home']))->json('data.id');
        $this->travel(1)->minutes();
        $office = $this->browse('POST', self::URL, $this->address(['label' => 'Office']))->assertCreated()
            ->assertJsonPath('data.is_default_shipping', false)->assertJsonPath('data.is_default_billing', false)->json('data.id');
        $this->travel(1)->minutes();
        $parents = $this->browse('POST', self::URL, $this->address(['label' => 'Parents', 'is_default_shipping' => true]))->json('data.id');

        $list = $this->browse('GET', self::URL)->assertOk()->json('data');
        $this->assertSame([$parents, $office, $home], array_column($list, 'id'));
        $this->assertSame([true, false, false], array_column($list, 'is_default_shipping'));

        // Switching the default off is ignored: there is always one.
        $this->browse('PATCH', self::URL.'/'.$parents, ['is_default_shipping' => false])->assertOk()->assertJsonPath('data.is_default_shipping', true);
        $this->browse('PATCH', self::URL.'/'.$office, ['is_default_billing' => true])->assertOk()->assertJsonPath('data.is_default_billing', true);
        // "Make default": the flag alone.
        $this->browse('PATCH', self::URL.'/'.$home, ['is_default_shipping' => true])->assertOk()->assertJsonPath('data.is_default_shipping', true)
            ->assertJsonPath('data.label', 'Home');
        $this->assertSame([$home], array_column(array_filter($this->browse('GET', self::URL)->json('data'), fn ($a) => $a['is_default_shipping']), 'id'));
        $this->browse('PATCH', self::URL.'/'.$parents, ['is_default_shipping' => true])->assertOk();

        // Deleting the default promotes the most recent remaining address.
        $this->browse('DELETE', self::URL.'/'.$parents)->assertNoContent();
        $list = $this->browse('GET', self::URL)->json('data');
        $this->assertSame([$office, $home], array_column($list, 'id'));
        $this->assertSame([true, false], array_column($list, 'is_default_shipping'));
        $this->assertSoftDeleted('customer_addresses', ['id' => $parents]);

        $this->browse('DELETE', self::URL.'/'.$office)->assertNoContent();
        $this->browse('GET', self::URL)->assertJsonPath('data.0.id', $home)->assertJsonPath('data.0.is_default_shipping', true)
            ->assertJsonPath('data.0.is_default_billing', true);
    }

    public function test_at_most_ten_addresses(): void
    {
        $this->registerShopper('shop.example.test');
        for ($i = 0; $i < CustomerAddressBook::MAX; $i++) {
            $this->browse('POST', self::URL, $this->address(['label' => "A{$i}"]))->assertCreated();
        }

        $this->browse('POST', self::URL, $this->address())->assertStatus(422)->assertJsonPath('error.code', 'ADDRESS_LIMIT_REACHED');
    }

    public function test_another_customers_address_is_not_found(): void
    {
        $this->registerShopper('shop.example.test', 'rina@example.test');
        $rinas = $this->browse('POST', self::URL, $this->address())->json('data.id');
        $this->browse('POST', 'http://shop.example.test/api/v1/store/account/logout')->assertNoContent();

        $this->registerShopper('shop.example.test', 'karim@example.test');
        $this->browse('GET', self::URL)->assertOk()->assertJsonCount(0, 'data');
        $this->browse('PATCH', self::URL.'/'.$rinas, ['label' => 'Mine'])->assertNotFound();
        $this->browse('DELETE', self::URL.'/'.$rinas)->assertNotFound();
        $this->assertDatabaseHas('customer_addresses', ['id' => $rinas, 'label' => 'Home', 'deleted_at' => null]);
    }
}
