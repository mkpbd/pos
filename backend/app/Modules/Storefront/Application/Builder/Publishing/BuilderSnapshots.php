<?php

namespace App\Modules\Storefront\Application\Builder\Publishing;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\BuilderPageRenderer;
use App\Modules\Storefront\Domain\Builder\BuilderDiff;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;

/**
 * B11: snapshots of a builder document side by side — the render payload of a version, a
 * checkpoint or a review's snapshot (with the draft rules: preview states, globals' drafts, so the
 * editor can draw it on a read-only canvas), and the change list between two of `draft`, `live`
 * or a version / checkpoint id of the document (BuilderDiff). `live` before the first publish is
 * an empty page; an id that is not one of the document's versions or checkpoints is 404
 * VERSION_NOT_FOUND.
 */
class BuilderSnapshots
{
    public function __construct(private readonly BuilderPageRenderer $renderer) {}

    /**
     * @param  array<string, mixed>  $content
     * @param  array<string, mixed>  $snapshot  `{kind, id, number, name}` added to the payload
     * @return array<string, mixed>
     */
    public function render(BuilderDocument $document, array $content, ?int $number, array $snapshot): array
    {
        return $this->renderer->render($document, $content, $number, 'draft') + ['snapshot' => $snapshot];
    }

    /**
     * @return array<string, mixed>
     */
    public function renderVersion(BuilderDocument $document, BuilderVersion $version): array
    {
        return $this->render($document, $version->content, $version->number, self::label($version));
    }

    /**
     * @return array{from: array<string, mixed>, to: array<string, mixed>, added: list<array<string, mixed>>, removed: list<array<string, mixed>>, changed: list<array<string, mixed>>, moved: list<string>}
     */
    public function compare(BuilderDocument $document, string $from, string $to): array
    {
        $a = $this->resolve($document, $from);
        $b = $this->resolve($document, $to);

        return ['from' => $a['label'], 'to' => $b['label']] + BuilderDiff::compare($a['content'], $b['content']);
    }

    /**
     * @param  array<string, mixed>  $content
     * @param  array<string, mixed>  $label  how the snapshot is named in `to`
     * @return array{from: array<string, mixed>, to: array<string, mixed>, added: list<array<string, mixed>>, removed: list<array<string, mixed>>, changed: list<array<string, mixed>>, moved: list<string>}
     */
    public function compareWithLive(BuilderDocument $document, array $content, array $label): array
    {
        $live = $this->resolve($document, 'live');

        return ['from' => $live['label'], 'to' => $label] + BuilderDiff::compare($live['content'], $content);
    }

    /**
     * @return array{content: array<string, mixed>, label: array{kind: string, id: ?string, number: ?int, name: ?string}}
     */
    private function resolve(BuilderDocument $document, string $token): array
    {
        if ($token === 'draft') {
            return ['content' => $document->draft, 'label' => ['kind' => 'draft', 'id' => null, 'number' => null, 'name' => null]];
        }
        if ($token === 'live') {
            $published = $document->publishedVersion;

            return [
                'content' => $published?->content ?? ['sections' => []],
                'label' => ['kind' => 'live', 'id' => $published?->id, 'number' => $published?->number, 'name' => $published?->name],
            ];
        }
        $version = BuilderVersion::query()->where('document_id', $document->id)->whereKey(strtolower($token))->first();
        if ($version === null) {
            throw new BusinessRuleViolation('VERSION_NOT_FOUND', 'This version no longer exists.', ['id' => $token], 404);
        }

        return ['content' => $version->content, 'label' => self::label($version)];
    }

    /**
     * @return array{kind: string, id: string, number: ?int, name: ?string}
     */
    private static function label(BuilderVersion $version): array
    {
        return ['kind' => $version->kind, 'id' => $version->id, 'number' => $version->number, 'name' => $version->name];
    }
}
