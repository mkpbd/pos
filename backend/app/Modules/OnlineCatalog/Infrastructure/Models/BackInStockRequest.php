<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P1a: a shopper asked to be e-mailed once when a sold-out variant is back.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $product_id
 * @property string $variant_id
 * @property string $email
 * @property ?string $customer_account_id
 * @property string $locale
 * @property string $site_url
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $notified_at
 */
#[Fillable(['organization_id', 'product_id', 'variant_id', 'email', 'customer_account_id', 'locale', 'site_url', 'notified_at'])]
class BackInStockRequest extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'notified_at' => 'immutable_datetime',
        ];
    }
}
