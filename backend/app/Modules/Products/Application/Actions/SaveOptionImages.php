<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Products\Domain\OptionStyle;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductOptionImage;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * P1a: "photos by colour". One option of a product (the photo option) can own photos: each of
 * its values gets an ordered list of the product's own images. Also sets the swatch style of
 * the product's options. Names and values are stored with the spelling of the product's
 * option definitions; every value not sent loses its photos.
 */
class SaveOptionImages
{
    public const MAX_IMAGES_PER_VALUE = 8;

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  array{photo_option?: ?string, styles?: ?array<string, ?string>, values?: ?list<array{value: string, image_ids?: ?list<string>}>}  $data
     */
    public function __invoke(Product $product, array $data): Product
    {
        $options = [];
        foreach ($product->options ?? [] as $option) {
            $options[mb_strtolower($option['name'])] = $option;
        }
        $errors = [];

        $photoOption = null;
        if (isset($data['photo_option']) && trim($data['photo_option']) !== '') {
            $photoOption = $options[mb_strtolower(trim($data['photo_option']))] ?? null;
            if ($photoOption === null) {
                $errors['photo_option'] = ['Choose one of the product\'s options.'];
            }
        }

        $styles = [];
        foreach ($product->option_styles ?? [] as $name => $style) {
            if (isset($options[mb_strtolower((string) $name)])) {
                $styles[$options[mb_strtolower((string) $name)]['name']] = $style;
            }
        }
        foreach ($data['styles'] ?? [] as $name => $style) {
            $option = $options[mb_strtolower(trim((string) $name))] ?? null;
            if ($option === null) {
                $errors["styles.{$name}"] = ['This is not an option of the product.'];

                continue;
            }
            if ($style === null) {
                unset($styles[$option['name']]);
            } elseif (OptionStyle::tryFrom($style) === null) {
                $errors["styles.{$name}"] = ['Choose color, image or button.'];
            } else {
                $styles[$option['name']] = $style;
            }
        }

        $rows = [];
        if ($photoOption !== null) {
            $knownValues = [];
            foreach ($photoOption['values'] as $value) {
                $knownValues[mb_strtolower((string) $value)] = (string) $value;
            }
            $imageIds = $product->images()->pluck('id')->all();
            $seenValues = [];
            foreach (array_values($data['values'] ?? []) as $i => $entry) {
                $value = $knownValues[mb_strtolower(trim((string) $entry['value']))] ?? null;
                if ($value === null) {
                    $errors["values.{$i}.value"] = ["\"{$entry['value']}\" is not a value of {$photoOption['name']}."];

                    continue;
                }
                if (isset($seenValues[$value])) {
                    $errors["values.{$i}.value"] = ["\"{$value}\" is listed twice."];

                    continue;
                }
                $seenValues[$value] = true;
                $ids = array_values($entry['image_ids'] ?? []);
                if (count($ids) > self::MAX_IMAGES_PER_VALUE) {
                    $errors["values.{$i}.image_ids"] = ['A value can have at most '.self::MAX_IMAGES_PER_VALUE.' photos.'];

                    continue;
                }
                foreach ($ids as $j => $imageId) {
                    if (! in_array($imageId, $imageIds, true)) {
                        $errors["values.{$i}.image_ids.{$j}"] = ['Choose one of the product\'s images.'];
                    } elseif (array_search($imageId, $ids, true) !== $j) {
                        $errors["values.{$i}.image_ids.{$j}"] = ['This photo is listed twice.'];
                    } else {
                        $rows[] = ['option_value' => $value, 'image_id' => $imageId, 'sort_order' => $j];
                    }
                }
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return DB::transaction(function () use ($product, $photoOption, $styles, $rows) {
            $before = $this->snapshot($product);

            $product->forceFill([
                'photo_option' => $photoOption['name'] ?? null,
                'option_styles' => $styles === [] ? null : $styles,
            ])->save();

            ProductOptionImage::query()->where('product_id', $product->id)->get()->each->delete();
            foreach ($rows as $row) {
                ProductOptionImage::query()->create($row + [
                    'organization_id' => $product->organization_id,
                    'product_id' => $product->id,
                    'option_name' => $photoOption['name'],
                ]);
            }

            $after = $this->snapshot($product->fresh() ?? $product);
            if ($before !== $after) {
                $this->audit->record('product.option_images_saved', $product, $before, $after);
            }

            return $product;
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(Product $product): array
    {
        $images = [];
        foreach (ProductOptionImage::query()->where('product_id', $product->id)->orderBy('option_value')->orderBy('sort_order')->get() as $row) {
            $images[$row->option_value][] = $row->image_id;
        }

        return [
            'photo_option' => $product->photo_option,
            'option_styles' => $product->option_styles,
            'option_images' => $images,
        ];
    }
}
