<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use App\Modules\Storefront\Application\Actions\ReplaceMenuItems;
use App\Modules\Storefront\Application\Actions\SaveMenu;
use App\Modules\Storefront\Domain\MenuLocation;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use App\Modules\Storefront\Presentation\Http\Requests\ReplaceMenuItemsRequest;
use App\Modules\Storefront\Presentation\Http\Support\StorefrontPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class MenuController
{
    /**
     * List menus
     *
     * One menu per location (`main`, `mobile`, `footer_1`..`footer_3`), without items.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(Menu::query()->get()
            ->sortBy(fn (Menu $m) => array_search($m->location, MenuLocation::cases(), true))
            ->map(fn (Menu $m) => StorefrontPresenter::menu($m, false))
            ->values()->all());
    }

    public function show(Menu $menu): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::menu($menu->load('items'), true));
    }

    public function store(Request $request, SaveMenu $save): JsonResponse
    {
        $data = $request->validate($this->rules(null));

        return ApiResponse::created(StorefrontPresenter::menu($save->save(new Menu, $data)->load('items'), true));
    }

    public function update(Request $request, Menu $menu, SaveMenu $save): JsonResponse
    {
        $data = $request->validate($this->rules($menu));

        return ApiResponse::success(StorefrontPresenter::menu($save->save($menu, $data)->load('items'), true));
    }

    /**
     * Replace menu items
     *
     * The complete, ordered tree (max. 3 levels, 200 items). Links are site paths (`/sale`) or http(s) URLs.
     * Mega menus (`is_mega`, `mega_columns`, `image_media_id`) are allowed on top-level items of the main menu only.
     */
    public function replaceItems(ReplaceMenuItemsRequest $request, Menu $menu, ReplaceMenuItems $replace): JsonResponse
    {
        return ApiResponse::success(StorefrontPresenter::menu($replace($menu, $request->items()), true));
    }

    public function destroy(Menu $menu, SaveMenu $save): JsonResponse
    {
        $save->delete($menu);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(?Menu $menu): array
    {
        $required = $menu === null ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:80'],
            'location' => [$required, Rule::enum(MenuLocation::class), (new TenantUnique('menus', 'location', $menu?->id))->withMessage('This location already has a menu.')],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
