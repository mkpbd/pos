<?php

namespace App\Modules\Storefront\Application\Builder\Publishing;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use Illuminate\Support\Facades\DB;

/**
 * B11: named versions and draft checkpoints. Versions stay what was published; a checkpoint is
 * the current draft saved as a named, unpublished snapshot (restored like a version with the
 * restore endpoint). At most 20 checkpoints per document: saving the 21st deletes the oldest
 * checkpoint without a name, and when every checkpoint has a name it is 422 CHECKPOINT_LIMIT.
 * Versions and checkpoints can be (re)named; only checkpoints can be deleted (a version: 409
 * VERSION_NOT_DELETABLE). Audited: storefront.builder_checkpoint_saved | _deleted,
 * storefront.builder_version_renamed.
 */
class BuilderCheckpoints
{
    public const MAX_CHECKPOINTS = 20;

    public const NAME_MAX = 80;

    public function __construct(private readonly AuditTrail $audit) {}

    public function save(BuilderDocument $document, ?string $name): BuilderVersion
    {
        $name = self::clean($name);

        return DB::transaction(function () use ($document, $name) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            $checkpoints = BuilderVersion::query()->where('document_id', $locked->id)->where('kind', BuilderVersion::KIND_CHECKPOINT);
            $pruned = null;
            if ((clone $checkpoints)->count() >= self::MAX_CHECKPOINTS) {
                $pruned = (clone $checkpoints)->whereNull('name')->orderBy('created_at')->orderBy('id')->first();
                if ($pruned === null) {
                    throw new BusinessRuleViolation('CHECKPOINT_LIMIT', 'This page already has '.self::MAX_CHECKPOINTS.' named copies. Delete one you no longer need first.', ['limit' => self::MAX_CHECKPOINTS]);
                }
                $pruned->delete();
            }

            $checkpoint = BuilderVersion::query()->create([
                'document_id' => $locked->id,
                'kind' => BuilderVersion::KIND_CHECKPOINT,
                'number' => null,
                'name' => $name,
                'schema_version' => $locked->schema_version,
                'content' => $locked->draft,
                'published_at' => null,
                'created_by' => StaffActor::id(),
            ]);
            $this->audit->record('storefront.builder_checkpoint_saved', $locked, [], [
                'version_id' => $checkpoint->id,
                'name' => $name,
            ], array_filter(['draft_revision' => $locked->draft_revision, 'pruned' => $pruned?->id]));

            return $checkpoint;
        });
    }

    public function rename(BuilderDocument $document, BuilderVersion $version, ?string $name): BuilderVersion
    {
        $name = self::clean($name);

        return DB::transaction(function () use ($document, $version, $name) {
            $locked = BuilderVersion::query()->whereKey($version->id)->lockForUpdate()->firstOrFail();
            $before = $locked->name;
            if ($before === $name) {
                return $locked;
            }
            $locked->name = $name;
            $locked->save();
            $this->audit->record('storefront.builder_version_renamed', $document, ['name' => $before], ['name' => $name], [
                'version_id' => $locked->id,
                'kind' => $locked->kind,
                'number' => $locked->number,
            ]);

            return $locked;
        });
    }

    public function delete(BuilderDocument $document, BuilderVersion $version): void
    {
        if (! $version->isCheckpoint()) {
            throw new BusinessRuleViolation('VERSION_NOT_DELETABLE', 'Published versions are kept as the page\'s history and cannot be deleted.', [], 409);
        }

        DB::transaction(function () use ($document, $version) {
            $version->delete();
            $this->audit->record('storefront.builder_checkpoint_deleted', $document, ['version_id' => $version->id, 'name' => $version->name]);
        });
    }

    private static function clean(?string $name): ?string
    {
        $name = $name === null ? null : trim($name);

        return $name === '' ? null : $name;
    }
}
