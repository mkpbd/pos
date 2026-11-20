<?php

namespace App\Modules\OnlineCatalog\Application\Ai;

use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Throwable;

/**
 * AI2a §2: writes an AI drafts batch, one subject (one model call, every language) at a time, in
 * the order of the batch. Each language becomes a draft: `pending` with the proposed texts and
 * the hash of the text each was based on, or `failed` with the reason (disabled | unavailable |
 * refused | empty | invalid | not_found | error). The batch counts done / failed subjects; it
 * stops when cancelled, with `budget_stopped` when the monthly AI budget runs out, and as
 * `cancelled` when AI is switched off meanwhile. Runs in the batch's organization.
 */
class RunAiDraftBatch
{
    public const FEATURE = 'catalog_drafts';

    public function __construct(private readonly CatalogTextWriter $writer) {}

    public function __invoke(AiContentBatch $batch): void
    {
        $started = AiContentBatch::query()->whereKey($batch->id)->where('status', 'queued')->update(['status' => 'running', 'updated_at' => now()]);
        if ($started === 0) {
            return;
        }

        foreach ($batch->criteria['ids'] ?? [] as $subjectId) {
            if (AiContentBatch::query()->whereKey($batch->id)->value('status') !== 'running') {
                return; // cancelled meanwhile
            }

            try {
                $result = $this->writer->write(
                    $batch->organization_id,
                    $batch->created_by,
                    self::FEATURE,
                    $batch->subject,
                    (string) $subjectId,
                    CatalogTextFields::applicable($batch->subject, $batch->fields),
                    $batch->languages,
                    $batch->tone,
                    $batch->length,
                    $batch->notes,
                );
            } catch (ModelNotFoundException) {
                $result = ['status' => 'not_found', 'name' => '', 'suggestions' => [], 'missing_info' => [], 'current' => []];
            } catch (Throwable $e) {
                report($e);
                $result = ['status' => 'error', 'name' => '', 'suggestions' => [], 'missing_info' => [], 'current' => []];
            }

            if ($result['status'] === 'budget_exceeded' || $result['status'] === 'disabled') {
                AiContentBatch::query()->whereKey($batch->id)->where('status', 'running')
                    ->update(['status' => $result['status'] === 'disabled' ? 'cancelled' : 'budget_stopped', 'updated_at' => now()]);

                return;
            }

            $written = $this->store($batch, (string) $subjectId, $result);
            AiContentBatch::query()->whereKey($batch->id)->increment($written ? 'done' : 'failed', 1, ['updated_at' => now()]);
        }

        AiContentBatch::query()->whereKey($batch->id)->where('status', 'running')->update(['status' => 'done', 'updated_at' => now()]);
    }

    /**
     * One draft per language; true when at least one has proposals.
     *
     * @param  array{status: string, name: string, suggestions: array<string, array<string, string>>, missing_info: list<string>, current: array<string, array<string, ?string>>}  $result
     */
    private function store(AiContentBatch $batch, string $subjectId, array $result): bool
    {
        $written = false;
        foreach ($batch->languages as $language) {
            $texts = $result['status'] === 'ok' ? ($result['suggestions'][$language] ?? []) : [];
            $fields = [];
            foreach ($texts as $field => $proposed) {
                $fields[$field] = ['proposed' => $proposed, 'base_hash' => CatalogTextFields::hash($result['current'][$language][$field] ?? null)];
            }
            $written = $written || $fields !== [];

            AiContentDraft::query()->updateOrCreate(
                ['batch_id' => $batch->id, 'subject_id' => $subjectId, 'language' => $language],
                [
                    'subject' => $batch->subject,
                    'subject_name' => mb_substr($result['name'], 0, 255),
                    'fields' => $fields === [] ? (object) [] : $fields,
                    'missing_info' => $fields === [] ? null : $result['missing_info'],
                    'status' => $fields === [] ? 'failed' : 'pending',
                    'error' => $fields === [] ? ($result['status'] === 'ok' ? 'empty' : $result['status']) : null,
                ],
            );
        }

        return $written;
    }
}
