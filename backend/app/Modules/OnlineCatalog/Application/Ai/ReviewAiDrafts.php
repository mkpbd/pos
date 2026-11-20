<?php

namespace App\Modules\OnlineCatalog\Application\Ai;

use App\Modules\OnlineCatalog\Application\Actions\SaveBrandListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveCategoryListing;
use App\Modules\OnlineCatalog\Application\Actions\SaveProductListing;
use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * AI2a §2: staff review of AI drafts. Approving saves **only the given fields** (staff may edit
 * them) through the listing's own save action — SaveProductListing / SaveCategoryListing /
 * SaveBrandListing: same sanitizing and audit; English to the listing field, Bangla to its E12b
 * translation. It never publishes: a product listing keeps its publishing state (a new one is
 * a draft) and a new category / brand listing is created hidden. A field whose text changed
 * since the draft was written makes the approval 409 DRAFT_STALE unless forced. Bulk approval
 * takes the proposals unchanged and skips (and marks) stale drafts. Audited with counts only.
 */
class ReviewAiDrafts
{
    public const MAX_BULK = 100;

    public function __construct(
        private readonly CatalogTextSubjects $subjects,
        private readonly SaveProductListing $saveProduct,
        private readonly SaveCategoryListing $saveCategory,
        private readonly SaveBrandListing $saveBrand,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $fields  {<field>: text}
     */
    public function approve(string $draftId, array $fields, bool $force, ?string $userId): AiContentDraft
    {
        return DB::transaction(function () use ($draftId, $fields, $force, $userId) {
            $draft = AiContentDraft::query()->lockForUpdate()->findOrFail(strtolower($draftId));
            self::assertOpen($draft);
            $values = $this->validated($draft, $fields);

            if ($this->subjects->names($draft->subject, [$draft->subject_id]) === []) {
                throw (new ModelNotFoundException)->setModel(AiContentDraft::class, [$draft->id]);
            }
            $current = $this->subjects->texts($draft->subject, [$draft->subject_id])[$draft->subject_id][$draft->language];
            $changed = array_values(array_filter(array_keys($values), fn (string $f) => CatalogTextFields::hash($current[$f] ?? null) !== ($draft->fields[$f]['base_hash'] ?? null)));
            if ($changed !== [] && ! $force) {
                throw new BusinessRuleViolation('DRAFT_STALE', 'These texts were changed after the AI wrote this draft. Check them, then approve anyway to replace them.', ['fields' => $changed], 409);
            }

            $data = CatalogTextSubjects::listingData($draft->subject, [$draft->language => $values], $this->subjects->listingExists($draft->subject, $draft->subject_id));
            match ($draft->subject) {
                'product' => ($this->saveProduct)($draft->subject_id, $data),
                'category' => ($this->saveCategory)($draft->subject_id, $data),
                'brand' => ($this->saveBrand)($draft->subject_id, $data),
            };

            $draft->update(['status' => 'approved', 'reviewed_by' => $userId, 'reviewed_at' => now()]);
            $this->audit->record('online_catalog.ai_draft_approved', $draft, [], [], [
                'subject' => $draft->subject,
                'subject_id' => $draft->subject_id,
                'language' => $draft->language,
                'fields' => count($values),
                'edited' => count(array_filter($values, fn (string $text, string $f) => $text !== ($draft->fields[$f]['proposed'] ?? null), ARRAY_FILTER_USE_BOTH)),
                'forced' => $changed !== [],
            ]);

            return $draft;
        });
    }

    public function reject(string $draftId, ?string $userId): AiContentDraft
    {
        return DB::transaction(function () use ($draftId, $userId) {
            $draft = AiContentDraft::query()->lockForUpdate()->findOrFail(strtolower($draftId));
            self::assertOpen($draft);
            $draft->update(['status' => 'rejected', 'reviewed_by' => $userId, 'reviewed_at' => now()]);
            $this->audit->record('online_catalog.ai_draft_rejected', $draft, [], [], [
                'subject' => $draft->subject,
                'subject_id' => $draft->subject_id,
                'language' => $draft->language,
            ]);

            return $draft;
        });
    }

    /**
     * Approves the proposals of many drafts unchanged; drafts that are gone, not open, failed or
     * stale are skipped (stale ones are marked `stale`).
     *
     * @param  list<string>  $ids
     * @return array{approved: list<string>, skipped: list<array{id: string, reason: string}>}
     */
    public function approveMany(array $ids, ?string $userId): array
    {
        $result = ['approved' => [], 'skipped' => []];
        foreach (array_values(array_unique(array_map('strtolower', $ids))) as $id) {
            $draft = AiContentDraft::query()->find($id);
            if ($draft === null) {
                $result['skipped'][] = ['id' => $id, 'reason' => 'not_found'];

                continue;
            }
            if (! in_array($draft->status, AiContentDraft::OPEN, true)) {
                $result['skipped'][] = ['id' => $id, 'reason' => $draft->status === 'failed' ? 'failed' : 'not_pending'];

                continue;
            }
            try {
                $this->approve($id, array_map(fn (array $f) => (string) ($f['proposed'] ?? ''), $draft->fields), false, $userId);
                $result['approved'][] = $id;
            } catch (BusinessRuleViolation $e) {
                if ($e->errorCode === 'DRAFT_STALE') {
                    AiContentDraft::query()->whereKey($id)->where('status', 'pending')->update(['status' => 'stale', 'updated_at' => now()]);
                }
                $result['skipped'][] = ['id' => $id, 'reason' => match ($e->errorCode) {
                    'DRAFT_STALE' => 'stale',
                    'DRAFT_NOT_PENDING' => 'not_pending',
                    default => 'invalid',
                }];
            } catch (ModelNotFoundException) {
                $result['skipped'][] = ['id' => $id, 'reason' => 'not_found'];
            } catch (ValidationException) {
                $result['skipped'][] = ['id' => $id, 'reason' => 'invalid'];
            }
        }

        return $result;
    }

    public function cancel(string $batchId): AiContentBatch
    {
        return DB::transaction(function () use ($batchId) {
            $batch = AiContentBatch::query()->lockForUpdate()->findOrFail(strtolower($batchId));
            if (! $batch->isActive()) {
                throw new BusinessRuleViolation('BATCH_NOT_RUNNING', 'These AI drafts are no longer being written.', ['status' => $batch->status], 409);
            }
            $batch->update(['status' => 'cancelled']);
            $this->audit->record('online_catalog.ai_drafts_cancelled', $batch, [], [], ['done' => $batch->done, 'failed' => $batch->failed, 'total' => $batch->total]);

            return $batch;
        });
    }

    private static function assertOpen(AiContentDraft $draft): void
    {
        if (! in_array($draft->status, AiContentDraft::OPEN, true)) {
            throw new BusinessRuleViolation('DRAFT_NOT_PENDING', 'This draft was already reviewed or has no texts.', ['status' => $draft->status], 409);
        }
    }

    /**
     * The texts to save: only fields of the draft, each a non-blank string within the field's
     * limit (the listing's own rule).
     *
     * @param  array<string, mixed>  $fields
     * @return array<string, string>
     */
    private function validated(AiContentDraft $draft, array $fields): array
    {
        $rules = ['fields' => ['required', 'array', 'min:1', 'array:'.implode(',', array_keys($draft->fields))]];
        foreach (array_keys($draft->fields) as $field) {
            $rules["fields.{$field}"] = ['sometimes', 'required', 'string', 'max:'.CatalogTextFields::limit($draft->subject, $field)];
        }
        $valid = Validator::make(['fields' => $fields], $rules, [
            'fields.array' => 'Choose texts of this draft only.',
        ])->validate();

        return array_map(fn ($text) => trim((string) $text), $valid['fields']);
    }
}
