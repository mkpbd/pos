<?php

namespace App\Modules\OnlinePayments\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * An organization's configuration of one payment method.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $code
 * @property bool $is_enabled
 * @property string $display_name
 * @property ?string $instructions
 * @property ?array<string, mixed> $settings
 * @property int $sort_order
 */
#[Table('payment_gateways')]
#[Fillable(['organization_id', 'code', 'is_enabled', 'display_name', 'instructions', 'settings', 'sort_order', 'translations'])]
class PaymentGatewaySetting extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected function casts(): array
    {
        return ['is_enabled' => 'boolean', 'settings' => 'array', 'sort_order' => 'integer', 'translations' => 'array'];
    }
}
