<?php

namespace App\Modules\Social\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Social\Domain\Meta\MetaPage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P2b: the connected Facebook Page (and its Instagram business account) of an organization.
 * The Page token and the granted Pages (with their tokens) are encrypted at rest and never
 * serialized; `sandbox` marks the simulated "Demo Page".
 *
 * @property string $id
 * @property string $organization_id
 * @property bool $sandbox
 * @property string $page_id
 * @property string $page_name
 * @property ?string $page_picture_url
 * @property string $page_token
 * @property list<array<string, mixed>> $pages
 * @property ?string $instagram_id
 * @property ?string $instagram_username
 * @property ?string $instagram_picture_url
 * @property ?CarbonImmutable $token_expires_at
 * @property ?string $connected_by
 * @property CarbonImmutable $connected_at
 */
#[Fillable([
    'organization_id', 'sandbox', 'page_id', 'page_name', 'page_picture_url', 'page_token', 'pages',
    'instagram_id', 'instagram_username', 'instagram_picture_url', 'token_expires_at', 'connected_by', 'connected_at',
])]
#[Hidden(['page_token', 'pages'])]
class SocialAccount extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'sandbox' => 'boolean',
            'page_token' => 'encrypted',
            'pages' => 'encrypted:array',
            'token_expires_at' => 'immutable_datetime',
            'connected_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * The connected Page with its token and Instagram account.
     */
    public function page(): MetaPage
    {
        return new MetaPage(
            $this->page_id,
            $this->page_name,
            $this->page_token,
            $this->page_picture_url,
            $this->instagram_id === null ? null : ['id' => $this->instagram_id, 'username' => (string) $this->instagram_username, 'picture_url' => $this->instagram_picture_url],
        );
    }

    /**
     * Uses one of the granted Pages (and its Instagram account).
     */
    public function usePage(MetaPage $page): void
    {
        $this->page_id = $page->id;
        $this->page_name = mb_substr($page->name, 0, 255);
        $this->page_picture_url = $page->pictureUrl === null ? null : mb_substr($page->pictureUrl, 0, 1000);
        $this->page_token = $page->accessToken;
        $this->instagram_id = $page->instagram['id'] ?? null;
        $this->instagram_username = isset($page->instagram['username']) ? mb_substr($page->instagram['username'], 0, 100) : null;
        $this->instagram_picture_url = isset($page->instagram['picture_url']) ? mb_substr((string) $page->instagram['picture_url'], 0, 1000) : null;
    }

    /**
     * Every granted Page.
     *
     * @return list<MetaPage>
     */
    public function grantedPages(): array
    {
        return array_values(array_map(fn (array $p) => MetaPage::fromArray($p), array_filter($this->pages, fn ($p) => is_array($p) && isset($p['id']))));
    }
}
