<?php

namespace App\Modules\Media\Presentation\Http\Controllers;

use App\Modules\Media\Application\Actions\DeleteMedia;
use App\Modules\Media\Application\Actions\UploadMedia;
use App\Modules\Media\Infrastructure\Models\Media;
use App\Modules\Media\Presentation\Http\Resources\MediaResource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

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
     * JPEG, PNG, WebP or GIF up to 5 MB. Uploading identical bytes again returns the
     * existing item with status 200 instead of 201.
     */
    public function store(Request $request, UploadMedia $upload): JsonResponse
    {
        $data = $request->validate([
            'file' => ['required', 'file', 'image', 'mimes:jpeg,png,webp,gif', 'max:5120', 'dimensions:max_width=6000,max_height=6000'],
            'alt' => ['sometimes', 'nullable', 'string', 'max:200'],
        ]);

        ['media' => $media, 'created' => $created] = $upload($request->file('file'), $data['alt'] ?? null);

        return $created ? ApiResponse::created(new MediaResource($media)) : ApiResponse::success(new MediaResource($media));
    }

    /**
     * Update alt text
     */
    public function update(Request $request, Media $media, AuditTrail $audit): JsonResponse
    {
        $data = $request->validate(['alt' => ['present', 'nullable', 'string', 'max:200']]);

        DB::transaction(function () use ($media, $data, $audit) {
            $old = $media->alt;
            $media->update(['alt' => $data['alt']]);
            if ($old !== $media->alt) {
                $audit->record('media.updated', $media, ['alt' => $old], ['alt' => $media->alt]);
            }
        });

        return ApiResponse::success(new MediaResource($media));
    }

    public function destroy(Media $media, DeleteMedia $delete): JsonResponse
    {
        $delete($media);

        return ApiResponse::noContent();
    }
}
