<?php

namespace App\Modules\Branches\Infrastructure\Database\Factories;

use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Branches\Infrastructure\Models\Store;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Store>
 */
class StoreFactory extends Factory
{
    protected $model = Store::class;

    public function definition(): array
    {
        return [
            'branch_id' => Branch::factory(),
            'organization_id' => fn (array $attributes) => Branch::query()->withoutGlobalScopes()->findOrFail($attributes['branch_id'])->organization_id,
            'code' => Str::upper(Str::random(6)),
            'name' => 'Store '.fake()->word(),
            'type' => 'store',
            'is_active' => true,
        ];
    }
}
