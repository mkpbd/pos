<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Storefront\Application\Builder\Collaboration\BuilderComments;
use App\Modules\Storefront\Infrastructure\Models\BuilderComment;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;

/**
 * B16: builder comments for the editor — a thread with its replies (oldest first), staff names
 * only, `node_removed` when its section / element is no longer in the draft, and what the viewer
 * may do (`can_edit`: the author within 15 minutes; `can_delete`: the author or a publisher).
 */
final class BuilderCommentPresenter
{
    /**
     * @param  iterable<BuilderComment>  $threads  with `replies` loaded
     * @return list<array<string, mixed>>
     */
    public static function threads(iterable $threads, BuilderDocument $document, ?string $viewerId, bool $mayPublish): array
    {
        $threads = collect($threads);
        $all = $threads->flatMap(fn (BuilderComment $c) => [$c, ...$c->replies]);
        $names = BuilderPublishingPresenter::names($all->flatMap(fn (BuilderComment $c) => [$c->author_id, $c->resolved_by, ...$c->mentions]));
        $nodes = array_flip(BuilderComments::nodeIds($document->draft));

        return $threads->map(fn (BuilderComment $c) => self::comment($c, $names, $nodes, $viewerId, $mayPublish))->values()->all();
    }

    /**
     * One comment (a thread with its replies, or a reply).
     *
     * @return array<string, mixed>
     */
    public static function one(BuilderComment $comment, BuilderDocument $document, ?string $viewerId, bool $mayPublish): array
    {
        if ($comment->isThread()) {
            $comment->load(['replies' => fn ($q) => $q->orderBy('created_at')->orderBy('id')]);
        } else {
            $comment->setRelation('replies', collect());
        }

        return self::threads([$comment], $document, $viewerId, $mayPublish)[0];
    }

    /**
     * @param  array<string, string>  $names
     * @param  array<string, int>  $nodes
     * @return array<string, mixed>
     */
    private static function comment(BuilderComment $c, array $names, array $nodes, ?string $viewerId, bool $mayPublish): array
    {
        $mine = $viewerId !== null && $c->author_id === $viewerId;

        return [
            'id' => $c->id,
            'number' => $c->number,
            'node_id' => $c->node_id,
            'node_removed' => $c->node_id !== null && ! isset($nodes[$c->node_id]),
            'anchor' => $c->anchor,
            'body' => $c->body,
            'mentions' => array_values(array_map(fn (string $id) => ['id' => $id, 'name' => $names[$id] ?? null], $c->mentions)),
            'author' => self::user($c->author_id, $names),
            'parent_id' => $c->parent_id,
            'resolved_at' => $c->resolved_at?->toIso8601String(),
            'resolved_by' => self::user($c->resolved_by, $names),
            'created_at' => $c->created_at->toIso8601String(),
            'updated_at' => $c->updated_at?->toIso8601String(),
            'edited_at' => $c->edited_at?->toIso8601String(),
            'can_edit' => $mine && $c->created_at->addMinutes(BuilderComment::EDIT_MINUTES)->isFuture(),
            'can_delete' => $mine || $mayPublish,
            'replies' => $c->isThread()
                ? $c->replies->map(fn (BuilderComment $r) => self::comment($r, $names, $nodes, $viewerId, $mayPublish))->values()->all()
                : [],
        ];
    }

    /**
     * @param  array<string, string>  $names
     * @return array{id: string, name: ?string}|null
     */
    private static function user(?string $id, array $names): ?array
    {
        return $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];
    }
}
