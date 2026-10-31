<?php

namespace App\Modules\Products\Tests\Unit;

use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Domain\ProductDefinitionRules;
use PHPUnit\Framework\TestCase;

class ProductDefinitionRulesTest extends TestCase
{
    /**
     * @param  array<string, mixed>  $overrides
     * @param  list<array<string, mixed>>  $variants
     */
    private function product(array $variants, array $overrides = []): ProductData
    {
        return ProductData::fromArray($overrides + [
            'name' => 'T-shirt',
            'type' => 'standard',
            'unit_id' => 'unit',
            'variants' => array_map(fn (array $v) => $v + ['purchase_price' => '100', 'selling_price' => '150'], $variants),
        ]);
    }

    private const SIZES = [['name' => 'Size', 'values' => ['S', 'M', 'L']], ['name' => 'Color', 'values' => ['Red', 'Blue']]];

    public function test_simple_product_is_valid(): void
    {
        $this->assertSame([], ProductDefinitionRules::violations($this->product([['sku' => 'TS-1', 'barcodes' => ['4006381333931']]])));
    }

    public function test_multiple_variants_need_options(): void
    {
        $errors = ProductDefinitionRules::violations($this->product([['sku' => 'A'], ['sku' => 'B']]));

        $this->assertArrayHasKey('options', $errors);
    }

    public function test_option_values_without_options_are_rejected(): void
    {
        $errors = ProductDefinitionRules::violations($this->product([['option_values' => ['Size' => 'S']]]));

        $this->assertArrayHasKey('variants.0.option_values', $errors);
    }

    public function test_valid_variant_matrix(): void
    {
        $product = $this->product([
            ['option_values' => ['Size' => 'S', 'Color' => 'Red']],
            ['option_values' => ['size' => 'm', 'color' => 'blue']], // case-insensitive
        ], ['options' => self::SIZES]);

        $this->assertSame([], ProductDefinitionRules::violations($product));
    }

    public function test_variant_must_cover_every_option_with_known_values(): void
    {
        $product = $this->product([
            ['option_values' => ['Size' => 'S']],
            ['option_values' => ['Size' => 'XL', 'Color' => 'Red']],
            ['option_values' => ['Size' => 'M', 'Color' => 'Red', 'Fit' => 'Slim']],
        ], ['options' => self::SIZES]);

        $errors = ProductDefinitionRules::violations($product);

        $this->assertArrayHasKey('variants.0.option_values', $errors);
        $this->assertStringContainsString('"XL" is not a value', $errors['variants.1.option_values']);
        $this->assertArrayHasKey('variants.2.option_values', $errors);
    }

    public function test_duplicate_combinations_skus_and_barcodes_are_rejected(): void
    {
        $product = $this->product([
            ['sku' => 'TS-S', 'option_values' => ['Size' => 'S', 'Color' => 'Red'], 'barcodes' => ['96385074']],
            ['sku' => 'ts-s', 'option_values' => ['Size' => 's', 'Color' => 'red'], 'barcodes' => ['96385074']],
        ], ['options' => self::SIZES]);

        $errors = ProductDefinitionRules::violations($product);

        $this->assertArrayHasKey('variants.1.sku', $errors);
        $this->assertArrayHasKey('variants.1.barcodes.0', $errors);
        $this->assertSame('Two variants have the same option values.', $errors['variants.1.option_values']);
    }

    public function test_duplicate_option_names_and_values(): void
    {
        $product = $this->product([['option_values' => ['Size' => 'S']]], ['options' => [
            ['name' => 'Size', 'values' => ['S', 's']],
            ['name' => 'size', 'values' => ['M']],
        ]]);

        $errors = ProductDefinitionRules::violations($product);

        $this->assertArrayHasKey('options.0.values', $errors);
        $this->assertArrayHasKey('options.1.name', $errors);
    }

    public function test_invalid_barcode(): void
    {
        $errors = ProductDefinitionRules::violations($this->product([['barcodes' => ['4006381333932']]]));

        $this->assertArrayHasKey('variants.0.barcodes.0', $errors);
    }

    public function test_batch_tracking_requires_stock_tracking(): void
    {
        $errors = ProductDefinitionRules::violations($this->product([[]], ['track_stock' => false, 'track_batches' => true]));

        $this->assertArrayHasKey('track_stock', $errors);
    }

    public function test_services_never_track_stock(): void
    {
        $product = $this->product([[]], ['type' => 'service', 'track_stock' => true, 'track_serials' => true]);

        $this->assertFalse($product->trackStock);
        $this->assertFalse($product->trackSerials);
        $this->assertSame([], ProductDefinitionRules::violations($product));
    }
}
