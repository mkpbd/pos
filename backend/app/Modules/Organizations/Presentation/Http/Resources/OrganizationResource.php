<?php

namespace App\Modules\Organizations\Presentation\Http\Resources;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Organization
 */
class OrganizationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'legal_name' => $this->legal_name,
            'tax_number' => $this->tax_number,
            'email' => $this->email,
            'phone' => $this->phone,
            'address' => $this->address,
            'base_currency' => $this->base_currency,
            'timezone' => $this->timezone,
            'tax_mode' => $this->tax_mode->value,
            'status' => $this->status->value,
            'settings' => (object) $this->settings,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
