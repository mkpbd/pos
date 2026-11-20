<?php

namespace App\Modules\OnlineCatalog\Application\Ai;

use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Collection;

/**
 * AI2a §2: what the "AI help → Drafts" page shows — batches with their progress and draft
 * counts, and drafts with the proposed texts next to the listing's current ones (`changed`: the
 * current text is no longer the one the proposal was written from).
 */
class AiDraftsView
{
    public function __construct(private readonly CatalogTextSubjects $subjects) {}

    /**
     * @param  array{status?: ?string, subject?: ?string, batch_id?: ?string, search?: ?string}  $filters
     * @return LengthAwarePaginator<int, AiContentDraft>
     */
    public function drafts(array $filters, int $perPage): LengthAwarePaginator
    {
        $search = trim((string) ($filters['search'] ?? ''));

        return AiContentDraft::query()
            ->when($filters['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($filters['subject'] ?? null, fn ($q, $subject) => $q->where('subject', $subject))
            ->when($filters['batch_id'] ?? null, fn ($q, $batchId) => $q->where('batch_id', strtolower($batchId)))
            ->when($search !== '', fn ($q) => $q->whereRaw('lower(subject_name) like ?', ['%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($search)).'%']))
            ->orderByDesc('created_at')->orderBy('subject_name')->orderBy('language')->orderBy('id')
            ->paginate($perPage);
    }

    /**
     * @param  iterable<AiContentDraft>  $drafts
     * @return list<array<string, mixed>>
     */
    public function presentDrafts(iterable $drafts): array
    {
        $drafts = Collection::make($drafts);
        $texts = [];
        foreach ($drafts->groupBy('subject') as $subject => $group) {
            $texts[$subject] = $this->subjects->texts((string) $subject, $group->pluck('subject_id')->all());
        }

        return $drafts->map(fn (AiContentDraft $d) => $this->draft($d, $texts[$d->subject][$d->subject_id][$d->language] ?? []))->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function presentDraft(AiContentDraft $draft): array
    {
        return $this->presentDrafts([$draft])[0];
    }

    /**
     * @param  array<string, ?string>  $current
     * @return array<string, mixed>
     */
    private function draft(AiContentDraft $d, array $current): array
    {
        $open = in_array($d->status, AiContentDraft::OPEN, true);
        $fields = [];
        foreach ($d->fields as $field => $value) {
            $now = $current[$field] ?? null;
            $fields[$field] = [
                'proposed' => (string) ($value['proposed'] ?? ''),
                'current' => $now,
                'changed' => $open && CatalogTextFields::hash($now) !== ($value['base_hash'] ?? null),
            ];
        }

        return [
            'id' => $d->id,
            'batch_id' => $d->batch_id,
            'subject' => $d->subject,
            'subject_id' => $d->subject_id,
            'subject_name' => $d->subject_name,
            'language' => $d->language,
            'status' => $d->status,
            'error' => $d->error,
            'fields' => $fields === [] ? (object) [] : $fields,
            'missing_info' => array_values($d->missing_info ?? []),
            'stale' => array_filter(array_column($fields, 'changed')) !== [],
            'reviewed_by' => $d->reviewed_by,
            'reviewed_at' => $d->reviewed_at?->toIso8601String(),
            'created_at' => $d->created_at?->toIso8601String(),
        ];
    }

    /**
     * @param  iterable<AiContentBatch>  $batches
     * @return list<array<string, mixed>>
     */
    public function presentBatches(iterable $batches): array
    {
        $batches = Collection::make($batches);
        $counts = [];
        if ($batches->isNotEmpty()) {
            foreach (AiContentDraft::query()->whereIn('batch_id', $batches->pluck('id')->all())
                ->groupBy('batch_id', 'status')->selectRaw('batch_id, status, COUNT(*) as n')->toBase()->get() as $row) {
                $counts[$row->batch_id][$row->status] = (int) $row->n;
            }
        }

        return $batches->map(fn (AiContentBatch $b) => $this->batch($b, $counts[$b->id] ?? []))->values()->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function presentBatch(AiContentBatch $batch): array
    {
        return $this->presentBatches([$batch])[0];
    }

    /**
     * @param  array<string, int>  $counts
     * @return array<string, mixed>
     */
    private function batch(AiContentBatch $b, array $counts): array
    {
        $processed = $b->done + $b->failed;

        return [
            'id' => $b->id,
            'subject' => $b->subject,
            'criteria' => ['missing' => $b->criteria['missing'] ?? null, 'ids' => array_values($b->criteria['ids'] ?? [])],
            'fields' => $b->fields,
            'languages' => $b->languages,
            'tone' => $b->tone,
            'length' => $b->length,
            'notes' => $b->notes,
            'total' => $b->total,
            'done' => $b->done,
            'failed' => $b->failed,
            'status' => $b->status,
            'progress_percent' => $b->total > 0 ? (int) floor(min($processed, $b->total) * 100 / $b->total) : 100,
            'drafts' => array_combine(AiContentDraft::STATUSES, array_map(fn (string $s) => $counts[$s] ?? 0, AiContentDraft::STATUSES)),
            'created_by' => $b->created_by,
            'created_at' => $b->created_at?->toIso8601String(),
            'updated_at' => $b->updated_at?->toIso8601String(),
        ];
    }
}
