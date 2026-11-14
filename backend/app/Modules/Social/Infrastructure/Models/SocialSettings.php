<?php

namespace App\Modules\Social\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Social\Domain\Meta\MetaApp;
use App\Modules\Social\Domain\SocialMode;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P2b: the organization's social media settings. The Meta app secret is encrypted at rest (the
 * `encrypted` cast) and never serialized.
 *
 * @property string $id
 * @property string $organization_id
 * @property SocialMode $mode
 * @property ?string $meta_app_id
 * @property ?string $meta_app_secret
 * @property string $graph_version
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'mode', 'meta_app_id', 'meta_app_secret', 'graph_version'])]
#[Hidden(['meta_app_secret'])]
class SocialSettings extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const DEFAULT_GRAPH_VERSION = 'v21.0';

    protected $table = 'social_settings';

    protected $attributes = [
        'mode' => 'sandbox',
        'graph_version' => self::DEFAULT_GRAPH_VERSION,
    ];

    protected function casts(): array
    {
        return [
            'mode' => SocialMode::class,
            'meta_app_secret' => 'encrypted',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /** The app id and secret are both set (live mode can be used). */
    public function liveReady(): bool
    {
        return is_string($this->meta_app_id) && $this->meta_app_id !== ''
            && is_string($this->meta_app_secret) && $this->meta_app_secret !== '';
    }

    /**
     * The Meta app (live) — in sandbox mode a placeholder the sandbox client ignores.
     */
    public function metaApp(): MetaApp
    {
        return new MetaApp((string) ($this->meta_app_id ?? 'sandbox'), (string) ($this->meta_app_secret ?? ''), $this->graph_version);
    }
}
