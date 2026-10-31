<?php

namespace App\Modules\Catalog\Presentation\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Shared output shape for catalog reference data: every attribute except tenant
 * and authorship columns, with ISO-8601 timestamps.
 */
class CatalogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $data = array_diff_key($this->resource->attributesToArray(), array_flip(['organization_id', 'created_by', 'updated_by']));
        $data['created_at'] = $this->resource->created_at?->toIso8601String();
        $data['updated_at'] = $this->resource->updated_at?->toIso8601String();

        return $data;
    }
}
