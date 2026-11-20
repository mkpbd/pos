<?php

namespace App\Modules\OnlineCatalog\Application\Ai;

use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\OnlineCatalog\Infrastructure\Jobs\WriteAiDrafts;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\Shared\Application\Contracts\AiFeatures;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * AI2a §2: starts an AI drafts run over the chosen products, categories or brands (`ids`, ≤ 200)
 * or over the active ones lacking texts (`missing`: description | seo | bangla; the first 200 by
 * name, skipping subjects that already have a draft waiting for review). The drafts are written
 * by a queued job, one model call per subject in sequence. One queued / running batch per
 * organization; a batch whose worker died (no progress for an hour) no longer blocks new ones.
 */
class CreateAiDraftBatch
{
    public const MAX_SUBJECTS = 200;

    /** A queued / running batch without progress for this long is treated as abandoned. */
    public const ABANDONED_AFTER_MINUTES = 60;

    public function __construct(
        private readonly CatalogTextSubjects $subjects,
        private readonly AiFeatures $features,
        private readonly TenantContext $tenant,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{subject: string, ids?: ?list<string>, missing?: ?list<string>, fields: list<string>, languages: list<string>, tone?: ?string, length?: ?string, notes?: ?string}  $input  validated
     */
    public function __invoke(array $input, ?string $userId): AiContentBatch
    {
        $organizationId = $this->tenant->requireOrganization();
        if (! $this->features->enabledFor($organizationId)) {
            throw WriteCatalogTexts::unavailable('disabled');
        }

        $subject = $input['subject'];
        $fields = CatalogTextFields::applicable($subject, $input['fields']);
        $languages = array_values(array_intersect(CatalogTextFields::LANGUAGES, $input['languages']));
        $missing = isset($input['missing']) ? array_values(array_intersect(['description', 'seo', 'bangla'], $input['missing'])) : null;
        if ($fields === [] || $languages === []) {
            throw self::nothingToWrite($subject);
        }

        if ($missing === null) {
            $ids = array_values(array_unique(array_map('strtolower', $input['ids'] ?? [])));
            if (count($ids) > self::MAX_SUBJECTS) {
                throw new BusinessRuleViolation('BATCH_TOO_LARGE', 'Choose at most '.self::MAX_SUBJECTS.' at a time.', ['limit' => self::MAX_SUBJECTS, 'count' => count($ids)]);
            }
            $names = $this->subjects->names($subject, $ids);
            if (($unknown = array_values(array_diff($ids, array_keys($names)))) !== []) {
                throw (new ModelNotFoundException)->setModel(match ($subject) {
                    'product' => ProductListing::class,
                    'category' => CategoryListing::class,
                    default => BrandListing::class,
                }, $unknown);
            }
        } else {
            $waiting = AiContentDraft::query()->where('subject', $subject)->whereIn('status', AiContentDraft::OPEN)
                ->distinct()->pluck('subject_id')->all();
            $ids = array_column($this->subjects->lacking($subject, $missing, $fields, $languages, $waiting, self::MAX_SUBJECTS), 'id');
        }
        if ($ids === []) {
            throw self::nothingToWrite($subject);
        }

        // A batch whose worker died must not block the store for good.
        AiContentBatch::query()->whereIn('status', AiContentBatch::ACTIVE)
            ->where('updated_at', '<', now()->subMinutes(self::ABANDONED_AFTER_MINUTES))
            ->update(['status' => 'cancelled', 'updated_at' => now()]);
        $this->assertNoneRunning();

        try {
            $batch = DB::transaction(fn () => AiContentBatch::query()->create([
                'created_by' => $userId,
                'subject' => $subject,
                'criteria' => ['missing' => $missing, 'ids' => $ids],
                'fields' => $fields,
                'languages' => $languages,
                'tone' => $input['tone'] ?? 'friendly',
                'length' => $input['length'] ?? 'medium',
                'notes' => ($notes = trim((string) ($input['notes'] ?? ''))) === '' ? null : $notes,
                'total' => count($ids),
                'status' => 'queued',
            ]));
        } catch (UniqueConstraintViolationException) {
            $this->assertNoneRunning();

            throw $this->running(null);
        }

        $this->audit->record('online_catalog.ai_drafts_started', $batch, [], [], [
            'subject' => $subject,
            'subjects' => count($ids),
            'fields' => count($fields),
            'languages' => count($languages),
            'missing' => $missing,
        ]);
        WriteAiDrafts::dispatch($batch->id);

        return $batch->fresh() ?? $batch;
    }

    private function assertNoneRunning(): void
    {
        $active = AiContentBatch::query()->whereIn('status', AiContentBatch::ACTIVE)->value('id');
        if ($active !== null) {
            throw $this->running((string) $active);
        }
    }

    private function running(?string $batchId): BusinessRuleViolation
    {
        return new BusinessRuleViolation('BATCH_RUNNING', 'AI drafts are already being written for your store. Wait until they are done or cancel them.', ['batch_id' => $batchId], 409);
    }

    public static function nothingToWrite(string $subject): BusinessRuleViolation
    {
        return new BusinessRuleViolation('NOTHING_TO_WRITE', match ($subject) {
            'category' => 'There is nothing to write: no category needs these texts.',
            'brand' => 'There is nothing to write: no brand needs these texts.',
            default => 'There is nothing to write: no product needs these texts.',
        });
    }
}
