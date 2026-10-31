<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $product_id
 * @property string $path path on the "public" disk
 * @property string $original_name
 * @property string $mime_type
 * @property int $size bytes
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'product_id', 'path', 'original_name', 'mime_type', 'size', 'sort_order'])]
class ProductImage extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'size' => 'integer',
            'sort_order' => 'integer',
        ];
    }

    /**
     * Same-origin URL, served by the web server (or the Vite proxy in development).
     */
    public function url(): string
    {
        return '/storage/'.ltrim($this->path, '/');
    }
}
