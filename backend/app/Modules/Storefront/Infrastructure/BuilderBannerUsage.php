<?php

namespace App\Modules\Storefront\Infrastructure;

use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderTemplate;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;
use Illuminate\Database\Eloquent\Builder;

/**
 * Where a banner is shown or kept besides one builder document's draft (in-place banner edits
 * from the builder): homepage sections, the drafts of the organization's other builder
 * documents (the theme draft included), every published version — the document's own too —
 * and the organization's saved templates. One `exists` query per table, scoped to the
 * organization like every query of these models.
 *
 * Builder JSON is matched as text, like BuilderMediaReferences: a banner id is a uuid, so it
 * only matches where it is referenced. PostgreSQL uses a jsonb path query on `item_id` values;
 * SQLite (the second test driver) a text match on the stored JSON.
 */
class BuilderBannerUsage
{
    public function usedOutsideDraftOf(string $bannerId, string $documentId): bool
    {
        $bannerId = strtolower($bannerId);

        return HomepageSectionItem::query()->where('item_type', HomepageSectionItem::TYPE_BANNER)->where('item_id', $bannerId)->exists()
            || $this->mentions(BuilderDocument::query()->whereKeyNot($documentId), 'draft', $bannerId)
            || $this->mentions(BuilderVersion::query(), 'content', $bannerId)
            || $this->mentions(BuilderTemplate::query(), 'content', $bannerId);
    }

    /**
     * @template TModel of \Illuminate\Database\Eloquent\Model
     *
     * @param  Builder<TModel>  $query
     */
    private function mentions(Builder $query, string $column, string $bannerId): bool
    {
        if ($query->getConnection()->getDriverName() === 'pgsql') {
            return $query->whereRaw("jsonb_path_exists({$column}, '\$.**.item_id ? (@ == \$id)', jsonb_build_object('id', ?::text))", [$bannerId])->exists();
        }

        return $query->whereRaw("CAST({$column} AS TEXT) LIKE ?", ['%'.$bannerId.'%'])->exists();
    }
}
