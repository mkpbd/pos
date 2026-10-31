<?php

namespace App\Modules\Products\Infrastructure\Database\Factories;

use App\Modules\Products\Infrastructure\Models\Product;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Bare product rows. Prefer the SaveProduct action in tests: it creates variants,
 * SKUs and barcodes exactly like the API does.
 *
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    protected $model = Product::class;

    public function definition(): array
    {
        return [
            'name' => fake()->words(3, true),
            'type' => 'standard',
            'track_stock' => true,
            'is_active' => true,
        ];
    }
}
