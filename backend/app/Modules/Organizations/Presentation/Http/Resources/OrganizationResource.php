<?php

namespace App\Modules\Organizations\Presentation\Http\Resources;

use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Contracts\TwoFactorOverview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Organization
 */
class OrganizationResource extends JsonResource
{
    private bool $withSecuritySummary = false;

    /**
     * G1a: adds `two_factor_summary` (staff adoption of two-factor sign-in) — for organization.update.
     */
    public function withSecuritySummary(bool $include = true): static
    {
        $this->withSecuritySummary = $include;

        return $this;
    }

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
            'settings' => (object) (($this->settings ?? []) + ['two_factor_policy' => Organization::TWO_FACTOR_OPTIONAL]),
            'two_factor_summary' => $this->when($this->withSecuritySummary, fn () => app(TwoFactorOverview::class)->summary($this->id)),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
