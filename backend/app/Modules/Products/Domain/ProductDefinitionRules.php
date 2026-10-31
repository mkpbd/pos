<?php

namespace App\Modules\Products\Domain;

use App\Modules\Products\Application\DTOs\ProductData;

/**
 * Consistency rules of a product definition that do not need the database.
 *
 * - Without options: exactly one variant, without attributes.
 * - With options: every variant names a value for every option (no extras),
 *   values come from the option's list, and no two variants share a combination.
 * - SKUs and barcodes are unique within the product; barcodes pass Barcode::isValid().
 * - Batch and serial tracking require stock tracking.
 */
final class ProductDefinitionRules
{
    public const MAX_VARIANTS = 100;

    /**
     * @return array<string, string> field path => message
     */
    public static function violations(ProductData $product): array
    {
        $errors = [];
        $variants = $product->variants;

        if (count($variants) === 0) {
            $errors['variants'] = 'A product needs at least one variant.';
        }
        if (count($variants) > self::MAX_VARIANTS) {
            $errors['variants'] = 'A product can have at most '.self::MAX_VARIANTS.' variants.';
        }

        if (($product->trackBatches || $product->trackSerials) && ! $product->trackStock) {
            $errors['track_stock'] = 'Batch or serial tracking requires stock tracking.';
        }

        if ($product->options === null) {
            if (count($variants) > 1) {
                $errors['options'] = 'Define options (e.g. Size, Color) to create more than one variant.';
            }
            foreach ($variants as $i => $variant) {
                if ($variant->optionValues !== []) {
                    $errors["variants.{$i}.option_values"] = 'Option values require matching product options.';
                }
            }
        } else {
            $errors += self::optionViolations($product);
        }

        $errors += self::uniquenessViolations($product);

        return $errors;
    }

    /**
     * @return array<string, string>
     */
    private static function optionViolations(ProductData $product): array
    {
        $errors = [];
        $options = [];

        foreach ($product->options as $i => $option) {
            $key = mb_strtolower($option['name']);
            if (isset($options[$key])) {
                $errors["options.{$i}.name"] = "Option \"{$option['name']}\" is defined twice.";
            }
            if (count(array_unique(array_map('mb_strtolower', $option['values']))) !== count($option['values'])) {
                $errors["options.{$i}.values"] = "Option \"{$option['name']}\" lists a value twice.";
            }
            $options[$key] = $option;
        }

        $seenCombinations = [];
        foreach ($product->variants as $i => $variant) {
            $attributes = array_change_key_case($variant->optionValues, CASE_LOWER);

            $missing = array_diff_key($options, $attributes);
            $extra = array_diff_key($attributes, $options);
            if ($missing !== [] || $extra !== []) {
                $errors["variants.{$i}.option_values"] = 'Each variant needs exactly one value for every option.';

                continue;
            }

            foreach ($attributes as $name => $value) {
                if (! in_array(mb_strtolower($value), array_map('mb_strtolower', $options[$name]['values']), true)) {
                    $errors["variants.{$i}.option_values"] = "\"{$value}\" is not a value of option \"{$options[$name]['name']}\".";
                }
            }

            ksort($attributes);
            $combination = mb_strtolower(json_encode($attributes));
            if (isset($seenCombinations[$combination])) {
                $errors["variants.{$i}.option_values"] = 'Two variants have the same option values.';
            }
            $seenCombinations[$combination] = true;
        }

        return $errors;
    }

    /**
     * @return array<string, string>
     */
    private static function uniquenessViolations(ProductData $product): array
    {
        $errors = [];
        $skus = [];
        $barcodes = [];

        foreach ($product->variants as $i => $variant) {
            if ($variant->sku !== null) {
                $sku = mb_strtolower($variant->sku);
                if (isset($skus[$sku])) {
                    $errors["variants.{$i}.sku"] = "SKU \"{$variant->sku}\" is used by two variants.";
                }
                $skus[$sku] = true;
            }

            foreach ($variant->barcodes as $j => $barcode) {
                if (! Barcode::isValid($barcode)) {
                    $errors["variants.{$i}.barcodes.{$j}"] = "Barcode \"{$barcode}\" is invalid (check digit or characters).";
                }
                if (isset($barcodes[$barcode])) {
                    $errors["variants.{$i}.barcodes.{$j}"] = "Barcode \"{$barcode}\" is used twice.";
                }
                $barcodes[$barcode] = true;
            }
        }

        return $errors;
    }
}
