<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderPublishSchedules;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use Illuminate\Support\Facades\DB;

/**
 * B14: "Use the standard page" — takes a store page template off the store: the published
 * pointer is cleared (the draft and every version stay, so publishing again brings it back) and a
 * pending "publish later" is cancelled. Template documents only (422 NOT_A_TEMPLATE); 409
 * NOTHING_PUBLISHED when it is not live. Audited; the model refreshes the storefront cache.
 */
class UnpublishStorePage
{
    public function __construct(
        private readonly AuditTrail $audit,
        private readonly BuilderPublishSchedules $schedules,
    ) {}

    public function __invoke(BuilderDocument $document): BuilderDocument
    {
        if ($document->templateKey() === null) {
            throw new BusinessRuleViolation('NOT_A_TEMPLATE', 'Only a store page design can be switched back to the standard page.');
        }

        return DB::transaction(function () use ($document) {
            $locked = BuilderDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();
            $before = $locked->published_version_id;
            if ($before === null) {
                throw new BusinessRuleViolation('NOTHING_PUBLISHED', 'This store page design is not on the store.', [], 409);
            }
            $this->schedules->cancelIfPending($locked, 'unpublished');
            $locked->published_version_id = null;
            $locked->save();
            $locked->setRelation('publishedVersion', null);
            $this->audit->record('storefront.builder_unpublished', $locked, ['published_version_id' => $before], ['published_version_id' => null], ['key' => $locked->key]);

            return $locked;
        });
    }
}
