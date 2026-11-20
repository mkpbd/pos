<?php

namespace App\Modules\Storefront\Application\Builder\Collaboration;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Infrastructure\Models\BuilderComment;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Notifications\BuilderCollaborationNotifier;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;

/**
 * B16: comments pinned on a builder document — threads on a section / element (`node_id`, an
 * `anchor` {x, y} inside it) or on the page, one level of replies, resolve / reopen (threads),
 * edit by the author within 15 minutes, delete by the author or someone who may publish (a
 * thread goes with its replies). `@name` mentions (and ids picked from the autocomplete) count
 * only for active staff of the organization who can view the store builder; mentioned staff and,
 * on replies, the thread's other participants get a bell notification. Resolving, reopening and
 * deleting are audited (on the document, for its activity log). Comments never reach the store
 * and do not need the edit lock.
 */
class BuilderComments
{
    public const STATUSES = ['open', 'resolved', 'all'];

    /** Mention autocomplete: at most this many names. */
    public const MENTIONABLE_MAX = 20;

    public function __construct(
        private readonly AuditTrail $audit,
        private readonly UserDirectory $users,
        private readonly BuilderCollaborationNotifier $notifier,
    ) {}

    /**
     * The document's threads (pin order) with their replies (oldest first).
     *
     * @return Collection<int, BuilderComment>
     */
    public function threads(BuilderDocument $document, string $status): Collection
    {
        return BuilderComment::query()
            ->where('document_id', $document->id)
            ->whereNull('parent_id')
            ->when($status === 'open', fn ($q) => $q->whereNull('resolved_at'))
            ->when($status === 'resolved', fn ($q) => $q->whereNotNull('resolved_at'))
            ->with(['replies' => fn ($q) => $q->orderBy('created_at')->orderBy('id')])
            ->orderBy('number')->orderBy('created_at')
            ->get();
    }

    /**
     * @return array{open: int, resolved: int}
     */
    public function counts(BuilderDocument $document): array
    {
        $threads = BuilderComment::query()->where('document_id', $document->id)->whereNull('parent_id');

        return [
            'open' => (clone $threads)->whereNull('resolved_at')->count(),
            'resolved' => (clone $threads)->whereNotNull('resolved_at')->count(),
        ];
    }

    /**
     * @param  array{body: string, node_id?: ?string, anchor?: ?array{x: float|int, y: float|int}, parent_id?: ?string, mentions?: ?list<string>}  $data  validated
     */
    public function post(BuilderDocument $document, array $data): BuilderComment
    {
        $author = $this->actor();
        $body = trim($data['body']);
        $parent = null;
        if (($data['parent_id'] ?? null) !== null) {
            $parent = BuilderComment::query()->where('document_id', $document->id)->whereNull('parent_id')
                ->whereKey(strtolower($data['parent_id']))->first();
            if ($parent === null) {
                throw new BusinessRuleViolation('INVALID_PARENT', 'You can only reply to a comment thread on this page.');
            }
        }
        $nodeId = $parent === null ? ($data['node_id'] ?? null) : null;
        if ($nodeId !== null && ! in_array($nodeId, self::nodeIds($document->draft), true)) {
            throw new BusinessRuleViolation('NODE_NOT_FOUND', 'This part of the page is not in the saved draft. Save the page first, then add the comment.', ['node_id' => $nodeId]);
        }
        $anchor = $parent === null && is_array($data['anchor'] ?? null)
            ? ['x' => round((float) $data['anchor']['x'], 4), 'y' => round((float) $data['anchor']['y'], 4)]
            : null;
        $mentions = $this->mentions($document, $body, $data['mentions'] ?? []);

        $comment = DB::transaction(function () use ($document, $parent, $nodeId, $anchor, $body, $mentions, $author) {
            $number = null;
            if ($parent === null) {
                // Pin numbers per document: serialized on the document row.
                BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->value('id');
                $number = (int) BuilderComment::withTrashed()->where('document_id', $document->id)->whereNull('parent_id')->max('number') + 1;
            }

            return BuilderComment::query()->create([
                'document_id' => $document->id,
                'parent_id' => $parent?->id,
                'number' => $number,
                'node_id' => $nodeId,
                'anchor' => $anchor,
                'body' => $body,
                'mentions' => $mentions,
                'author_id' => $author,
            ]);
        });

        $name = $this->name($document, $author);
        $mentioned = array_values(array_diff($mentions, [$author]));
        $this->notifier->mentioned($document, $comment, $mentioned, $name);
        if ($parent !== null) {
            $participants = BuilderComment::query()->where(fn ($q) => $q->whereKey($parent->id)->orWhere('parent_id', $parent->id))
                ->whereNotNull('author_id')->pluck('author_id')->all();
            $this->notifier->replied($document, $comment, array_values(array_diff(array_unique($participants), [$author], $mentioned)), $name);
        }

        return $comment;
    }

    /**
     * The author changes the text within EDIT_MINUTES (403 COMMENT_NOT_YOURS, 422
     * COMMENT_EDIT_CLOSED); newly mentioned staff are notified.
     */
    public function edit(BuilderDocument $document, BuilderComment $comment, string $body): BuilderComment
    {
        $author = $this->actor();
        $this->assertOn($document, $comment);
        if ($comment->author_id !== $author) {
            throw new BusinessRuleViolation('COMMENT_NOT_YOURS', 'Only the person who wrote this comment can change it.', [], 403);
        }
        if ($comment->created_at->addMinutes(BuilderComment::EDIT_MINUTES)->isPast()) {
            throw new BusinessRuleViolation('COMMENT_EDIT_CLOSED', 'Comments can be changed for '.BuilderComment::EDIT_MINUTES.' minutes after posting. Add a reply instead.');
        }
        $body = trim($body);
        if ($body === $comment->body) {
            return $comment;
        }
        $before = $comment->mentions;
        $mentions = $this->mentions($document, $body, []);
        // Mentions picked from the autocomplete earlier stay while the name is still in the text.
        $comment->forceFill(['body' => $body, 'mentions' => $mentions, 'edited_at' => CarbonImmutable::now()])->save();

        $this->notifier->mentioned($document, $comment, array_values(array_diff($mentions, $before, [$author])), $this->name($document, $author));

        return $comment;
    }

    public function resolve(BuilderDocument $document, BuilderComment $comment, bool $resolved): BuilderComment
    {
        $actor = $this->actor();
        $this->assertOn($document, $comment);
        if (! $comment->isThread()) {
            throw new BusinessRuleViolation('NOT_A_THREAD', 'Resolve or reopen the whole thread, not a reply.');
        }
        if (($comment->resolved_at !== null) === $resolved) {
            return $comment;
        }

        return DB::transaction(function () use ($document, $comment, $resolved, $actor) {
            $comment->forceFill(['resolved_at' => $resolved ? CarbonImmutable::now() : null, 'resolved_by' => $resolved ? $actor : null])->save();
            $this->audit->record($resolved ? 'storefront.builder_comment_resolved' : 'storefront.builder_comment_reopened', $document, [], [
                'comment_id' => $comment->id,
                'number' => $comment->number,
            ]);

            return $comment;
        });
    }

    /**
     * By the author or someone who may publish (403 COMMENT_NOT_YOURS); a thread goes with its
     * replies. Soft delete; audited.
     */
    public function delete(BuilderDocument $document, BuilderComment $comment, bool $mayPublish): void
    {
        $actor = $this->actor();
        $this->assertOn($document, $comment);
        if ($comment->author_id !== $actor && ! $mayPublish) {
            throw new BusinessRuleViolation('COMMENT_NOT_YOURS', 'Only the person who wrote this comment, or someone who may publish, can delete it.', [], 403);
        }

        DB::transaction(function () use ($document, $comment) {
            $replies = 0;
            if ($comment->isThread()) {
                $replies = BuilderComment::query()->where('parent_id', $comment->id)->delete();
            }
            $comment->delete();
            $this->audit->record('storefront.builder_comment_deleted', $document, [
                'comment_id' => $comment->id,
                'number' => $comment->number,
                'author_id' => $comment->author_id,
            ], [], array_filter(['reply' => ! $comment->isThread(), 'replies' => $replies]));
        });
    }

    /**
     * Staff who can view the store builder, by name (contains `$query`), at most MENTIONABLE_MAX.
     *
     * @return list<array{id: string, name: string}>
     */
    public function mentionable(string $organizationId, ?string $query): array
    {
        $query = mb_strtolower(trim((string) $query));

        return collect($this->candidates($organizationId))
            ->filter(fn (string $name) => $query === '' || str_contains(mb_strtolower($name), $query))
            ->sort(fn (string $a, string $b) => strcasecmp($a, $b))
            ->take(self::MENTIONABLE_MAX)
            ->map(fn (string $name, string $id) => ['id' => $id, 'name' => $name])
            ->values()
            ->all();
    }

    /**
     * Ids of every section, column and element in a draft.
     *
     * @param  array<string, mixed>  $content
     * @return list<string>
     */
    public static function nodeIds(array $content): array
    {
        $ids = [];
        BuilderDocumentSchema::walk($content, function (array $node) use (&$ids) {
            if (is_string($node['id'] ?? null)) {
                $ids[] = $node['id'];
            }
        });

        return $ids;
    }

    /**
     * `@Name` in the text (longest names first, case-insensitive, not inside a word) plus ids
     * picked from the autocomplete — only staff who can view the store builder.
     *
     * @param  list<string>|null  $picked
     * @return list<string>
     */
    private function mentions(BuilderDocument $document, string $body, ?array $picked): array
    {
        $candidates = $this->candidates($document->organization_id);
        $found = [];
        if (str_contains($body, '@')) {
            uksort($candidates, fn ($a, $b) => mb_strlen($candidates[$b]) <=> mb_strlen($candidates[$a]));
            $text = $body;
            foreach ($candidates as $id => $name) {
                $pattern = '/(?<![\pL\pN_@])@'.preg_quote($name, '/').'(?![\pL\pN_])/iu';
                if (preg_match($pattern, $text) === 1) {
                    $found[] = (string) $id;
                    // A longer name ("Rima Akter") is not also "Rima".
                    $text = (string) preg_replace($pattern, ' ', $text);
                }
            }
        }
        foreach ($picked ?? [] as $id) {
            $id = strtolower((string) $id);
            if (isset($candidates[$id])) {
                $found[] = $id;
            }
        }

        return array_values(array_unique($found));
    }

    /**
     * @return array<string, string> names by id
     */
    private function candidates(string $organizationId): array
    {
        return $this->users->withPermission($organizationId, 'storefront.view')
            ->mapWithKeys(fn ($user) => [(string) $user->getAuthIdentifier() => (string) $user->getAttribute('name')])
            ->filter(fn (string $name) => trim($name) !== '')
            ->all();
    }

    private function assertOn(BuilderDocument $document, BuilderComment $comment): void
    {
        if ($comment->document_id !== $document->id) {
            throw (new ModelNotFoundException)->setModel(BuilderComment::class, [$comment->id]);
        }
    }

    private function actor(): string
    {
        return StaffActor::id() ?? throw new BusinessRuleViolation('STAFF_ONLY', 'Only staff can comment on store pages.', [], 403);
    }

    private function name(BuilderDocument $document, string $userId): string
    {
        return $this->users->names($document->organization_id, [$userId])[$userId] ?? 'Someone';
    }
}
