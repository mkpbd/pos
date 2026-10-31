<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Actions\ManageHomepageSections;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Presentation\Http\Requests\SaveHomepageSectionRequest;
use App\Modules\Storefront\Presentation\Http\Support\ContentPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HomepageSectionController
{
    /**
     * List homepage sections
     *
     * In display order, with `state`: `live`, `disabled`, `scheduled` or `expired`.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(HomepageSection::query()->with('items')->orderBy('sort_order')->get()
            ->map(fn (HomepageSection $s) => ContentPresenter::section($s))->all());
    }

    /**
     * Section types
     *
     * The types the builder offers, with the banner placement they show, item limits and default config.
     */
    public function types(): JsonResponse
    {
        return ApiResponse::success(ContentPresenter::types());
    }

    public function show(HomepageSection $section): JsonResponse
    {
        return ApiResponse::success(ContentPresenter::section($section->load('items')));
    }

    /**
     * Add a section
     *
     * Goes last. Banner sections take `banner_ids` (banners of the type's placement, in order).
     * Rich text is sanitized. Validation of `config` depends on `type`.
     */
    public function store(SaveHomepageSectionRequest $request, ManageHomepageSections $sections): JsonResponse
    {
        return ApiResponse::created(ContentPresenter::section($sections->save(new HomepageSection, $request->validated())));
    }

    public function update(SaveHomepageSectionRequest $request, HomepageSection $section, ManageHomepageSections $sections): JsonResponse
    {
        return ApiResponse::success(ContentPresenter::section($sections->save($section, $request->validated())));
    }

    /**
     * Duplicate a section
     *
     * A disabled copy right after the original.
     */
    public function duplicate(HomepageSection $section, ManageHomepageSections $sections): JsonResponse
    {
        return ApiResponse::created(ContentPresenter::section($sections->duplicate($section)));
    }

    public function destroy(HomepageSection $section, ManageHomepageSections $sections): JsonResponse
    {
        $sections->delete($section);

        return ApiResponse::noContent();
    }

    /**
     * Reorder sections
     *
     * Every section id exactly once, in the new order.
     */
    public function reorder(Request $request, ManageHomepageSections $sections): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['present', 'array', 'max:'.ManageHomepageSections::MAX_SECTIONS],
            'ids.*' => ['uuid', 'distinct'],
        ]);
        $sections->reorder($data['ids']);

        return $this->index();
    }
}
