<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property bool $is_enabled
 * @property string $site_name
 * @property ?string $meta_description
 * @property ?string $fulfilment_store_id stock location deciding online availability
 * @property bool $guest_checkout_enabled shoppers may check out without an account
 * @property int $return_window_days days after delivery a web order can be returned (0 = no online returns; E10b)
 * @property bool $allow_indexing search engines may index the store (false: robots Disallow + noindex; E12)
 * @property bool $bangla_enabled shoppers may switch the store to Bangla (E12b)
 * @property string $default_locale `en` or `bn` (must be enabled; E12b)
 * @property bool $bangla_digits amounts and numbers in Bengali digits when reading in Bangla (E12b)
 */
#[Fillable(['organization_id', 'is_enabled', 'site_name', 'meta_description', 'fulfilment_store_id', 'guest_checkout_enabled', 'return_window_days', 'allow_indexing', 'bangla_enabled', 'default_locale', 'bangla_digits'])]
class StorefrontSettings extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $table = 'storefront_settings';

    protected $attributes = [
        'is_enabled' => false,
        'guest_checkout_enabled' => true,
        'return_window_days' => 7,
        'allow_indexing' => true,
        'bangla_enabled' => true,
        'default_locale' => 'en',
        'bangla_digits' => false,
    ];

    protected function casts(): array
    {
        return ['is_enabled' => 'boolean', 'guest_checkout_enabled' => 'boolean', 'return_window_days' => 'integer', 'allow_indexing' => 'boolean', 'bangla_enabled' => 'boolean', 'bangla_digits' => 'boolean'];
    }
}
