<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * B9: global sections — one section (`global:<uuid>` documents) shown wherever a
 * `global_section` node refers to it.
 *
 * - expand(): replaces the references of a document's content with the globals' sections — the
 *   published version for a published render, the draft for a draft render. The section takes
 *   the reference node's id (the editor selects the reference) and gains
 *   `global: {id, title, section_id, version}`; the reference's own hidden / schedule are kept in
 *   `global_ref` for the renderer. A missing global, one that was never published (published
 *   render) or one made for another context stays a `global_section` node with `unavailable`.
 * - usage(): the documents whose draft or live version refers to a global (organization-scoped).
 */
class BuilderGlobals
{
    /**
     * @param  array<string, mixed>  $content  normalized
     * @param  'published'|'draft'  $source
     * @param  ?string  $context  the host document's context (null: no fit check)
     * @return array<string, mixed>
     */
    public function expand(array $content, string $source, ?string $context): array
    {
        $refs = BuilderDocumentSchema::globalRefs($content);
        if ($refs === []) {
            return $content;
        }
        $globals = BuilderDocument::query()->where('kind', BuilderDocument::KIND_GLOBAL)->with('publishedVersion')
            ->whereIn('id', $refs)->get()->keyBy('id');

        foreach ($content['sections'] as $i => $node) {
            if (($node['type'] ?? null) !== BuilderDocumentSchema::GLOBAL_SECTION) {
                continue;
            }
            /** @var BuilderDocument|null $global */
            $global = $globals->get($node['ref']);
            $fits = $global !== null && ($context === null || BuilderReferences::globalFits((string) $global->context, $context));
            $body = ! $fits ? null : ($source === 'draft' ? $global->draft : $global->publishedVersion?->content);
            $section = $body['sections'][0] ?? null;
            if (! is_array($section) || ($section['type'] ?? null) !== 'section') {
                $content['sections'][$i] = $node + [
                    'global' => ['id' => $node['ref'], 'title' => $global?->title, 'section_id' => null, 'version' => null],
                    'unavailable' => true,
                ];

                continue;
            }

            $section['global'] = [
                'id' => $global->id,
                'title' => $global->title,
                'section_id' => $section['id'],
                'version' => $source === 'draft' ? null : $global->publishedVersion?->number,
            ];
            $section['id'] = $node['id'];
            $section['global_ref'] = ['hidden' => $node['hidden'] ?? false, 'schedule' => $node['schedule'] ?? null];
            $content['sections'][$i] = $section;
        }

        return $content;
    }

    /**
     * The documents (other than globals) whose draft or live version refers to these globals:
     * global id => `[{id, title, kind, key}]` ordered by title.
     *
     * @param  list<string>  $globalIds
     * @return array<string, list<array{id: string, title: string, kind: string, key: string}>>
     */
    public function usage(array $globalIds): array
    {
        $result = array_fill_keys($globalIds, []);
        if ($globalIds === []) {
            return $result;
        }
        $documents = BuilderDocument::query()->builder()->where('kind', '!=', BuilderDocument::KIND_GLOBAL)
            ->with('publishedVersion')
            ->where(function (Builder $query) use ($globalIds) {
                foreach ($globalIds as $id) {
                    $query->orWhere(fn (Builder $q) => $this->refersTo($q, 'draft', $id))
                        ->orWhereHas('publishedVersion', fn (Builder $q) => $this->refersTo($q, 'content', $id));
                }
            })
            ->orderBy('title')->get();

        foreach ($documents as $document) {
            $refs = array_unique([
                ...BuilderDocumentSchema::globalRefs($document->draft),
                ...BuilderDocumentSchema::globalRefs($document->publishedVersion->content ?? []),
            ]);
            foreach ($refs as $ref) {
                if (array_key_exists($ref, $result)) {
                    $result[$ref][] = ['id' => $document->id, 'title' => $document->title, 'kind' => $document->kind, 'key' => $document->key];
                }
            }
        }

        return $result;
    }

    /**
     * A jsonb path query on PostgreSQL (only `ref` values of section-level references match);
     * a text match elsewhere (filtered exactly by usage()).
     *
     * @param  Builder<covariant \Illuminate\Database\Eloquent\Model>  $query
     */
    private function refersTo(Builder $query, string $column, string $globalId): void
    {
        if (DB::getDriverName() === 'pgsql') {
            $query->whereRaw("jsonb_path_exists({$column}, '\$.sections[*] ? (@.type == \"global_section\" && @.ref == \$id)', jsonb_build_object('id', ?::text))", [$globalId]);

            return;
        }
        $query->where($column, 'like', '%'.$globalId.'%');
    }
}
