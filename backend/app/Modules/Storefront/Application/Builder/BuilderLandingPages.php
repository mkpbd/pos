<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Marketing\Application\Contracts\LandingPages;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;

/**
 * P2a: landing pages (`landing:<slug>` builder documents, shown at `/p/<slug>`) for campaigns.
 */
class BuilderLandingPages implements LandingPages
{
    public function all(): array
    {
        return BuilderDocument::query()
            ->where('kind', BuilderDocument::KIND_PAGE)
            ->where('key', 'like', BuilderDocument::LANDING_PREFIX.'%')
            ->orderBy('title')->orderBy('key')
            ->get()
            ->map(fn (BuilderDocument $d) => self::present($d))
            ->values()
            ->all();
    }

    public function find(array $ids): array
    {
        $ids = array_values(array_filter($ids, fn ($id) => is_string($id) && preg_match('/^[0-9a-f-]{36}$/', $id) === 1));
        if ($ids === []) {
            return [];
        }
        $result = [];
        foreach (BuilderDocument::query()->whereIn('id', $ids)->where('kind', BuilderDocument::KIND_PAGE)->where('key', 'like', BuilderDocument::LANDING_PREFIX.'%')->get() as $document) {
            $result[$document->id] = self::present($document);
        }

        return $result;
    }

    public function idForPath(string $path): ?string
    {
        if (preg_match('#^/p/([a-z0-9-]{2,60})/?$#', $path, $m) !== 1) {
            return null;
        }
        $id = BuilderDocument::query()->where('key', BuilderDocument::LANDING_PREFIX.$m[1])->value('id');

        return is_string($id) ? $id : null;
    }

    /**
     * @return array{id: string, title: string, slug: string, path: string, published: bool}
     */
    private static function present(BuilderDocument $document): array
    {
        $slug = (string) $document->landingSlug();

        return [
            'id' => $document->id,
            'title' => $document->title,
            'slug' => $slug,
            'path' => '/p/'.$slug,
            'published' => $document->published_version_id !== null,
        ];
    }
}
