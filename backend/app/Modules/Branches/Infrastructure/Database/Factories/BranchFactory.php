<?php

namespace App\Modules\Branches\Infrastructure\Database\Factories;

use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Branch>
 */
class BranchFactory extends Factory
{
    protected $model = Branch::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'code' => Str::upper(Str::random(6)),
            'name' => fake()->city().' Branch',
            'is_active' => true,
            'allow_negative_stock' => false,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
