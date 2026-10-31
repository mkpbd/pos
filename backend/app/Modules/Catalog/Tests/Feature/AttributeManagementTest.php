<?php

namespace App\Modules\Catalog\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AttributeManagementTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    public function test_attributes_with_ordered_values_are_created_updated_and_deleted(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $colour = $this->postJson('/api/v1/attributes', [
            'name' => 'Colour', 'display' => 'swatch', 'is_filterable' => true,
            'values' => [['value' => 'Red', 'swatch_hex' => '#FF0000'], ['value' => 'Blue', 'swatch_hex' => '#0000ff']],
        ])->assertCreated()
            ->assertJsonPath('data.slug', 'colour')
            ->assertJsonPath('data.values.0.swatch_hex', '#ff0000')
            ->json('data');
        $this->postJson('/api/v1/attributes', ['name' => 'Size', 'display' => 'button', 'is_filterable' => false, 'values' => [['value' => 'M']]])->assertCreated();

        [$red, $blue] = $colour['values'];
        // Swap the names of existing values, add one, drop none: ids are kept.
        $updated = $this->patchJson("/api/v1/attributes/{$colour['id']}", ['values' => [
            ['id' => $red['id'], 'value' => 'Blue', 'swatch_hex' => '#0000ff'],
            ['id' => $blue['id'], 'value' => 'Red', 'swatch_hex' => '#ff0000'],
            ['value' => 'Green'],
        ]])->assertOk()->json('data');
        $this->assertSame([[$red['id'], 'Blue'], [$blue['id'], 'Red']], array_map(fn ($v) => [$v['id'], $v['value']], array_slice($updated['values'], 0, 2)));
        $this->assertSame('Green', $updated['values'][2]['value']);

        $this->patchJson("/api/v1/attributes/{$colour['id']}", ['values' => [['id' => $blue['id'], 'value' => 'Red']]])->assertOk()->assertJsonCount(1, 'data.values');

        $this->assertSame(['Colour', 'Size'], array_column($this->getJson('/api/v1/attributes')->assertOk()->json('data'), 'name'));

        $this->postJson('/api/v1/attributes', ['name' => 'colour', 'display' => 'button', 'is_filterable' => true, 'values' => []])
            ->assertUnprocessable()->assertJsonValidationErrors('name', 'error.details');
        $this->postJson('/api/v1/attributes', ['name' => 'Fit', 'display' => 'dropdown', 'is_filterable' => true, 'values' => [['value' => 'A'], ['value' => 'a']]])
            ->assertUnprocessable()->assertJsonValidationErrors(['display', 'values.1.value'], 'error.details');
        $this->postJson('/api/v1/attributes', ['name' => 'Fit', 'display' => 'swatch', 'is_filterable' => true, 'values' => [['value' => 'A', 'swatch_hex' => 'red']]])
            ->assertUnprocessable()->assertJsonValidationErrors('values.0.swatch_hex', 'error.details');

        $this->deleteJson("/api/v1/attributes/{$colour['id']}")->assertNoContent();
        $this->assertSame(0, DB::table('attribute_values')->where('attribute_id', $colour['id'])->count());
        $this->assertTrue(DB::table('audit_logs')->where('action', 'attribute.deleted')->exists());
    }
}
