<?php

namespace App\Modules\Storefront\Presentation\Http\Exports;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use App\Modules\Storefront\Domain\Forms\FormAnswers;
use Illuminate\Http\Request;

/**
 * B8b: GET /forms/submissions?export=csv|xlsx|pdf. With a chosen form (`form=<document>:<element>`)
 * one column per field label of that form (every field its submissions had, the latest order
 * first); without one a summary of the first answers.
 */
class FormSubmissionsExport extends ListExport
{
    /**
     * @param  list<array{id: string, label: string, kind: string}>|null  $fields  the chosen form's fields, or null
     */
    public function __construct(private readonly ?array $fields = null, private readonly ?string $formTitle = null) {}

    public function name(): string
    {
        return 'form-submissions';
    }

    public function title(): string
    {
        return $this->formTitle === null ? 'Form submissions' : "Form submissions: {$this->formTitle}";
    }

    public function columns(): array
    {
        $columns = [
            ExportColumn::dateTime('created_at', 'Received'),
            ...($this->fields === null ? [ExportColumn::text('form_title', 'Form')] : []),
            ExportColumn::text('status', 'Status', fn (array $r) => ucfirst((string) ($r['status'] ?? ''))),
            ExportColumn::text('reply_to', 'Reply to'),
            ExportColumn::text('page_path', 'Page'),
        ];
        if ($this->fields === null) {
            $columns[] = ExportColumn::text('summary', 'Answers');

            return $columns;
        }
        foreach ($this->fields as $field) {
            $id = $field['id'];
            $columns[] = ExportColumn::text('values.'.$id, $field['label'], fn (array $r) => FormAnswers::text(((array) ($r['values'] ?? []))[$id] ?? null));
        }

        return $columns;
    }

    public function filters(Request $request): array
    {
        return FilterSummary::of($request)->search()->value('status', 'Status')->dates()->all();
    }
}
