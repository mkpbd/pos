<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Actions\ManageCustomFonts;
use App\Modules\Storefront\Application\Queries\CustomFonts;
use App\Modules\Storefront\Domain\Woff2Font;
use App\Modules\Storefront\Infrastructure\Models\StorefrontFont;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * B10: the store's own fonts for the theme (heading, body and Bangla fonts as `custom:<id>`).
 * Reading needs storefront.view, uploading and deleting storefront.manage.
 */
class CustomFontController
{
    public function __construct(private readonly CustomFonts $fonts) {}

    /**
     * List custom fonts
     *
     * `{fonts: [{id, key: "custom:<id>", name, family, url, format: "woff2", weight_min,
     * weight_max, size, used_by: [live_theme|theme_draft], roles: [heading|body|bangla_heading|
     * bangla_body], created_at}], limit: 4, max_bytes: 512000}` by name.
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success([
            'fonts' => $this->fonts->all()->map(fn (StorefrontFont $font) => $this->present($font))->values()->all(),
            'limit' => CustomFonts::LIMIT,
            'max_bytes' => Woff2Font::MAX_BYTES,
        ]);
    }

    /**
     * Upload a custom font
     *
     * Multipart `{file, name, weight_min?, weight_max?}`: a WOFF2 file of at most 500 KB (checked
     * by its header: 422 INVALID_FONT), a name (1–60, unique in the store), the weights it covers
     * (100–900 in steps of 100; default 400, the maximum defaults to the minimum). At most 4 per
     * store (422 FONT_LIMIT_REACHED, `details.limit`); the same file twice is 422 FONT_DUPLICATE
     * (`details.font_id`). Audited.
     */
    public function store(Request $request, ManageCustomFonts $manage): JsonResponse
    {
        $weights = array_map('strval', range(100, 900, 100));
        $data = $request->validate([
            'file' => ['required', 'file', 'max:'.(Woff2Font::MAX_BYTES / 1024)],
            'name' => ['required', 'string', 'max:60', 'regex:/\S/'],
            'weight_min' => ['sometimes', 'integer', 'in:'.implode(',', $weights)],
            'weight_max' => ['sometimes', 'integer', 'in:'.implode(',', $weights)],
        ]);
        $min = (int) ($data['weight_min'] ?? 400);
        $max = (int) ($data['weight_max'] ?? $min);
        if ($max < $min) {
            throw ValidationException::withMessages(['weight_max' => 'The heaviest weight must be at least the lightest weight.']);
        }

        return ApiResponse::created($this->present($manage->upload($request->file('file'), $data['name'], $min, $max)));
    }

    /**
     * Delete a custom font
     *
     * Refused while the live theme or the theme draft uses it: 409 FONT_IN_USE with
     * `details.used_by` (`live_theme`, `theme_draft`) and `details.roles`. Audited.
     */
    public function destroy(StorefrontFont $font, ManageCustomFonts $manage): JsonResponse
    {
        $manage->delete($font);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function present(StorefrontFont $font): array
    {
        return [
            'id' => $font->id,
            'key' => $font->key(),
            'name' => $font->name,
            'family' => $font->family(),
            'url' => $font->url(),
            'format' => 'woff2',
            'weight_min' => $font->weight_min,
            'weight_max' => $font->weight_max,
            'size' => $font->size,
            ...$this->fonts->usage($font->id),
            'created_at' => $font->created_at?->toIso8601String(),
        ];
    }
}
