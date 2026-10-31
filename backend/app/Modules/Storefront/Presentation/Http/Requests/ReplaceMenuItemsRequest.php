<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Storefront\Domain\MenuItemType;
use App\Modules\Storefront\Presentation\Http\Rules\SafeLink;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The full, ordered item tree of a menu: up to three levels.
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
            $rules["{$prefix}.url"] = ['required', new SafeLink];
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

    public function messages(): array
    {
        return ['*.prohibited' => 'Menus can be nested at most '.self::MAX_DEPTH.' levels deep.'];
    }
}
