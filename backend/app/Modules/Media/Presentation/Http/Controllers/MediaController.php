<?php

namespace App\Modules\Media\Presentation\Http\Controllers;

use App\Modules\Media\Application\Actions\DeleteMedia;
use App\Modules\Media\Application\Actions\EditMedia;
use App\Modules\Media\Application\Actions\UpdateMediaDetails;
use App\Modules\Media\Application\Actions\UploadMedia;
use App\Modules\Media\Domain\ImageEdit;
use App\Modules\Media\Infrastructure\MediaUsage;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Media\Presentation\Http\Resources\MediaResource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MediaController
{
    /**
     * List media
     *
     * Newest first; `?search=` matches the original file name and alt text; `?ids=` (comma-separated,
     * up to 100) returns exactly those items, e.g. to show what a setting points at.
     */
    public function index(Request $request): JsonResponse
    {
        $ids = array_values(array_filter(explode(',', (string) $request->query('ids', ''))));
        Validator::make(['ids' => $ids], ['ids' => ['array', 'max:100'], 'ids.*' => ['uuid']])->validate();

        return ApiResponse::paginated(
            ListQuery::paginate(
                Media::query()->when($ids !== [], fn (Builder $query) => $query->whereIn('id', $ids)),
                $request,
                ['created_at', 'original_name', 'size'],
                ['original_name', 'alt'],
            ),
            MediaResource::class,
        );
    }

    /**
     * Upload an image
     *
     * JPEG, PNG, WebP or GIF up to 5 MB and 6000 × 6000 px. Uploading identical bytes again returns
     * the existing item with status 200 instead of 201. B11: JPEG/PNG/WebP originals larger than
     * 2560 px on a side are stored scaled down (EXIF orientation applied, metadata stripped).
     * B22a: AVIF too when the server's GD reads it (stored as uploaded, WebP renditions);
     * otherwise 422 UNSUPPORTED_IMAGE.
     */
    public function store(Request $request, UploadMedia $upload): JsonResponse
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'image', 'mimes:jpeg,png,webp,gif,avif', 'max:5120', 'dimensions:max_width=6000,max_height=6000'],
            'alt' => ['sometimes', 'nullable', 'string', 'max:200'],
        ]);

        ['media' => $media, 'created' => $created] = $upload($request->file('file'), $data['alt'] ?? null);

        return $created ? ApiResponse::created(new MediaResource($media)) : ApiResponse::success(new MediaResource($media));
    }

    /**
     * Update alt text or focal point
     *
     * Any of `alt`, `focal_x` + `focal_y` (0–100, percent of the width / height; both null = centre).
     */
    public function update(Request $request, Media $media, UpdateMediaDetails $update): JsonResponse
    {
        if (! $request->hasAny(['alt', 'focal_x', 'focal_y'])) {
            throw ValidationException::withMessages(['alt' => 'Give the alt text or a focal point.']);
        }
        if ($request->has('focal_x') !== $request->has('focal_y')) {
            throw ValidationException::withMessages(['focal_x' => 'Give both focal_x and focal_y.']);
        }
        $data = $request->validate([
            'alt' => ['sometimes', 'nullable', 'string', 'max:200'],
            'focal_x' => ['sometimes', 'nullable', 'integer', 'between:0,100'],
            'focal_y' => ['sometimes', 'nullable', 'integer', 'between:0,100'],
        ]);

        return ApiResponse::success(new MediaResource($update($media, $data)));
    }

    /**
     * Where a media item is used
     *
     * `{in_use, places}` — plain-word names of the store areas that show this picture.
     */
    public function usage(Media $media, MediaUsage $usage): JsonResponse
    {
        $places = $usage->places($media->id);

        return ApiResponse::success(['in_use' => $places !== [], 'places' => $places]);
    }

    /**
     * Edit a picture
     *
     * Crop (source pixels, before turning), rotate clockwise, flip, brightness / contrast /
     * saturation (−50…50). `mode: copy` (default) adds an edited copy (201; 200 when identical
     * bytes already exist); `mode: replace` changes the picture everywhere it is used — refused
     * with `IN_USE` and the places unless `confirm_replace` is true. Optional focal point of the
     * result in percent.
     */
    public function edit(Request $request, Media $media, EditMedia $edit): JsonResponse
    {
        $data = $request->validate([
            'crop' => ['sometimes', 'nullable', 'array:x,y,w,h'],
            'crop.x' => ['required_with:crop', 'integer', 'min:0'],
            'crop.y' => ['required_with:crop', 'integer', 'min:0'],
            'crop.w' => ['required_with:crop', 'integer', 'min:1'],
            'crop.h' => ['required_with:crop', 'integer', 'min:1'],
            'rotate' => ['sometimes', 'integer', Rule::in(ImageEdit::ROTATIONS)],
            'flip_h' => ['sometimes', 'boolean'],
            'flip_v' => ['sometimes', 'boolean'],
            'brightness' => ['sometimes', 'integer', 'between:'.ImageEdit::ADJUST_MIN.','.ImageEdit::ADJUST_MAX],
            'contrast' => ['sometimes', 'integer', 'between:'.ImageEdit::ADJUST_MIN.','.ImageEdit::ADJUST_MAX],
            'saturation' => ['sometimes', 'integer', 'between:'.ImageEdit::ADJUST_MIN.','.ImageEdit::ADJUST_MAX],
            'mode' => ['sometimes', Rule::in(['copy', 'replace'])],
            'confirm_replace' => ['sometimes', 'boolean'],
            'focal_x' => ['sometimes', 'nullable', 'required_with:focal_y', 'integer', 'between:0,100'],
            'focal_y' => ['sometimes', 'nullable', 'required_with:focal_x', 'integer', 'between:0,100'],
        ]);

        $focal = isset($data['focal_x'], $data['focal_y']) ? ['x' => (int) $data['focal_x'], 'y' => (int) $data['focal_y']] : null;
        ['media' => $result, 'created' => $created] = $edit(
            $media,
            ImageEdit::fromArray($data),
            $data['mode'] ?? 'copy',
            (bool) ($data['confirm_replace'] ?? false),
            $focal,
        );

        return $created ? ApiResponse::created(new MediaResource($result)) : ApiResponse::success(new MediaResource($result));
    }

    public function destroy(Media $media, DeleteMedia $delete): JsonResponse
    {
        $delete($media);

        return ApiResponse::noContent();
    }
}
