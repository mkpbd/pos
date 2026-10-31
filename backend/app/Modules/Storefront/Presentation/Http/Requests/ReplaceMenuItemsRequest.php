<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Storefront\Domain\MenuItemType;
use App\Modules\Storefront\Presentation\Http\Rules\SafeLink;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The full, ordered item tree of a menu: up to three levels. Custom items carry a `url`,
 * page items a `target_id` (the content page).
 */
class ReplaceMenuItemsRequest extends FormRequest
{
    public const MAX_DEPTH = 3;

    public function rules(): array
    {
        $rules = ['items' => ['present', 'array']];

        $prefix = 'items.*';
        for ($level = 1; $level <= self::MAX_DEPTH; $level++) {
            $rules[$prefix] = ['array'];
            $rules["{$prefix}.type"] = ['sometimes', Rule::enum(MenuItemType::class)];
            $rules["{$prefix}.label"] = ['required', 'string', 'max:80'];
            $rules["{$prefix}.url"] = ["required_unless:{$prefix}.type,page", 'nullable', new SafeLink];
            $rules["{$prefix}.target_id"] = ["required_if:{$prefix}.type,page", 'nullable', 'uuid'];
            $rules["{$prefix}.open_in_new_tab"] = ['sometimes', 'boolean'];
            $rules["{$prefix}.is_visible"] = ['sometimes', 'boolean'];
            $rules["{$prefix}.is_mega"] = ['sometimes', 'boolean'];
            $rules["{$prefix}.mega_columns"] = ['sometimes', 'nullable', 'integer', 'between:2,4'];
            $rules["{$prefix}.image_media_id"] = ['sometimes', 'nullable', 'uuid'];
            $rules["{$prefix}.children"] = $level < self::MAX_DEPTH ? ['sometimes', 'array'] : ['prohibited'];
            $prefix .= '.children.*';
        }

        return $rules;
    }

    /**
     * The validated tree in the order it was sent. validated() rebuilds arrays from the
     * expanded rules, so an item whose optional keys are absent can move behind later ones.
     *
     * @return list<array<string, mixed>>
     */
    public function items(): array
    {
        return self::ordered($this->validated()['items']);
    }

    /**
     * @param  array<int, array<string, mixed>>  $items
     * @return list<array<string, mixed>>
     */
    private static function ordered(array $items): array
    {
        ksort($items);

        return array_map(function (array $item) {
            if (isset($item['children'])) {
                $item['children'] = self::ordered($item['children']);
            }

            return $item;
        }, array_values($items));
    }

    public function messages(): array
    {
        return ['*.prohibited' => 'Menus can be nested at most '.self::MAX_DEPTH.' levels deep.'];
    }
}
