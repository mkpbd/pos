<?php

namespace App\Modules\Branches\Presentation\Http\Resources;

use App\Modules\Branches\Infrastructure\Models\Branch;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Branch
 */
class BranchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'address' => $this->address,
            'timezone' => $this->timezone,
            'is_active' => $this->is_active,
            'allow_negative_stock' => $this->allow_negative_stock,
            'stores' => StoreResource::collection($this->whenLoaded('stores')),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
