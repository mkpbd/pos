<?php

namespace App\Modules\Storefront\Application\Forms;

use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * B8b: reads of form submissions for staff (organization-scoped through the model's global
 * scope): the forms with their counts, the filtered submission list (search, status, form,
 * dates in the organization's time zone) and the status counts.
 */
class FormSubmissionQueries
{
    public const FORM_PATTERN = '/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([a-z][a-z0-9_-]{1,31})$/';

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * Every form element of the store's builder documents (drafts and published versions) and
     * every form that has submissions: `[{document_id, element_id, title, document_title,
     * document_kind, total, new, last_submitted_at}]`, the most recently used first (then by
     * title). `title` is the form's current title (draft first), else the last submission's
     * snapshot; `document_title` / `document_kind` are null when the document was deleted.
     *
     * @return list<array<string, mixed>>
     */
    public function forms(): array
    {
        $forms = [];
        $documents = BuilderDocument::query()->builder()->with('publishedVersion')->get();
        foreach ($documents as $document) {
            $contents = array_filter([$document->draft, $document->publishedVersion?->content]);
            foreach ($contents as $content) {
                foreach (SubmitBuilderForm::forms($content) as $form) {
                    $key = $document->id.':'.$form['id'];
                    if (! isset($forms[$key])) {
                        $forms[$key] = $this->form($document->id, $form['id'], $form['title'], $document);
                    }
                }
            }
        }

        $stats = BuilderFormSubmission::query()
            ->select(['document_id', 'element_id'])
            ->selectRaw('count(*) as total')
            ->selectRaw("sum(case when status = 'new' then 1 else 0 end) as new_count")
            ->selectRaw('max(created_at) as last_at')
            ->groupBy('document_id', 'element_id')
            ->get();
        $byId = $documents->keyBy('id');
        foreach ($stats as $row) {
            $key = $row->document_id.':'.$row->element_id;
            if (! isset($forms[$key])) {
                $title = BuilderFormSubmission::query()->where('document_id', $row->document_id)->where('element_id', $row->element_id)
                    ->orderByDesc('created_at')->value('form_title');
                $forms[$key] = $this->form($row->document_id, $row->element_id, (string) $title, $byId[$row->document_id] ?? null);
            }
            $forms[$key]['total'] = (int) $row->total;
            $forms[$key]['new'] = (int) $row->new_count;
            $forms[$key]['last_submitted_at'] = $row->last_at === null ? null : CarbonImmutable::parse($row->last_at)->toIso8601String();
        }

        $forms = array_values($forms);
        usort($forms, fn (array $a, array $b) => [$b['last_submitted_at'] !== null, $b['last_submitted_at'] ?? '', $a['title']] <=> [$a['last_submitted_at'] !== null, $a['last_submitted_at'] ?? '', $b['title']]);

        return $forms;
    }

    /**
     * The submissions matching the filters, newest first.
     *
     * @param  array{form?: ?string, status?: ?string, search?: ?string, from?: ?string, to?: ?string}  $filters  validated
     * @return Builder<BuilderFormSubmission>
     */
    public function list(array $filters): Builder
    {
        $query = BuilderFormSubmission::query();
        $this->filter($query, $filters, true);

        return $query->orderByDesc('created_at')->orderByDesc('id');
    }

    /**
     * `{new, read, archived}` for the same filters without the status.
     *
     * @param  array{form?: ?string, status?: ?string, search?: ?string, from?: ?string, to?: ?string}  $filters
     * @return array{new: int, read: int, archived: int}
     */
    public function statusCounts(array $filters): array
    {
        $query = BuilderFormSubmission::query();
        $this->filter($query, $filters, false);
        $counts = $query->groupBy('status')->select('status', DB::raw('count(*) as n'))->pluck('n', 'status')->all();

        return [
            'new' => (int) ($counts['new'] ?? 0),
            'read' => (int) ($counts['read'] ?? 0),
            'archived' => (int) ($counts['archived'] ?? 0),
        ];
    }

    /**
     * The fields of a form for its export columns: every field its submissions had (by id; the
     * latest submission's labels and order first, older fields after), and its latest title.
     *
     * @return array{fields: list<array{id: string, label: string, kind: string}>, title: ?string}
     */
    public function formFields(string $form): array
    {
        if (preg_match(self::FORM_PATTERN, $form, $m) !== 1) {
            return ['fields' => [], 'title' => null];
        }
        $rows = BuilderFormSubmission::query()->where('document_id', $m[1])->where('element_id', $m[2])
            ->orderByDesc('created_at')->orderByDesc('id')->limit(500)->get(['fields', 'form_title']);
        $fields = [];
        foreach ($rows as $row) {
            foreach ($row->fields as $field) {
                $fields[$field['id']] ??= $field;
            }
        }

        return ['fields' => array_values($fields), 'title' => $rows->first()?->form_title];
    }

    /**
     * Document titles and kinds of the given ids (deleted documents are absent).
     *
     * @param  list<string>  $ids
     * @return array<string, array{title: string, kind: string}>
     */
    public function documents(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return BuilderDocument::query()->builder()->whereIn('id', array_values(array_unique($ids)))->get(['id', 'title', 'kind'])
            ->mapWithKeys(fn (BuilderDocument $d) => [$d->id => ['title' => $d->title, 'kind' => $d->kind]])->all();
    }

    /**
     * @param  Builder<BuilderFormSubmission>  $query
     * @param  array<string, mixed>  $filters
     */
    private function filter(Builder $query, array $filters, bool $withStatus): void
    {
        if (is_string($filters['form'] ?? null) && preg_match(self::FORM_PATTERN, $filters['form'], $m) === 1) {
            $query->where('document_id', $m[1])->where('element_id', $m[2]);
        }
        if ($withStatus && is_string($filters['status'] ?? null)) {
            $query->where('status', $filters['status']);
        }
        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $like = '%'.mb_strtolower(addcslashes($search, '%_\\')).'%';
            $query->where(fn (Builder $q) => $q
                ->whereRaw('lower(form_title) like ?', [$like])
                ->orWhereRaw('lower(reply_to) like ?', [$like])
                ->orWhereRaw('lower(cast("values" as text)) like ?', [$like]));
        }
        $timezone = $this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? 'UTC';
        if (is_string($filters['from'] ?? null)) {
            $query->where('created_at', '>=', CarbonImmutable::parse($filters['from'], $timezone)->startOfDay()->utc());
        }
        if (is_string($filters['to'] ?? null)) {
            $query->where('created_at', '<', CarbonImmutable::parse($filters['to'], $timezone)->startOfDay()->addDay()->utc());
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function form(string $documentId, string $elementId, string $title, ?BuilderDocument $document): array
    {
        return [
            'document_id' => $documentId,
            'element_id' => $elementId,
            'title' => trim($title) !== '' ? $title : 'Form on '.($document->title ?? 'a deleted page'),
            'document_title' => $document?->title,
            'document_kind' => $document?->kind,
            'total' => 0,
            'new' => 0,
            'last_submitted_at' => null,
        ];
    }
}
