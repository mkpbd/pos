<?php

namespace App\Modules\Organizations\Infrastructure\Models;

use App\Modules\Organizations\Domain\Enums\OrganizationStatus;
use App\Modules\Organizations\Domain\Enums\TaxMode;
use App\Modules\Organizations\Infrastructure\Database\Factories\OrganizationFactory;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $name
 * @property string $slug
 * @property OrganizationStatus $status
 * @property TaxMode $tax_mode
 * @property string $base_currency
 * @property string $timezone
 * @property array<string, mixed> $settings
 */
#[UseFactory(OrganizationFactory::class)]
#[Fillable([
    'name', 'slug', 'legal_name', 'tax_number', 'email', 'phone', 'address',
    'base_currency', 'timezone', 'tax_mode', 'status', 'settings',
])]
class Organization extends Model
{
    /** @use HasFactory<OrganizationFactory> */
    use ChangesStorefrontContent, HasFactory, HasUuids, TracksAuthor;

    protected $attributes = [
        'settings' => '{}',
        'status' => 'active',
        'tax_mode' => 'exclusive',
    ];

    protected function casts(): array
    {
        return [
            'status' => OrganizationStatus::class,
            'tax_mode' => TaxMode::class,
            'settings' => 'array',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === OrganizationStatus::Active;
    }

    /** The storefront shows the organization's currency, tax mode and contact details (E12). */
    protected function storefrontOrganizationId(): ?string
    {
        return $this->exists ? $this->getKey() : null;
    }
}
