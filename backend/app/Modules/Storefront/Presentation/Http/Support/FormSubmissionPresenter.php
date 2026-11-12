<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\Forms\FormAnswers;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use App\Modules\Users\Application\Contracts\UserDirectory;
use stdClass;

/**
 * B8b: API shapes of form submissions.
 */
final class FormSubmissionPresenter
{
    /**
     * `{id, document_id, element_id, form_title, document_title, fields, values, summary,
     * reply_to, locale, page_path, status, read_at, read_by: {id, name}|null, created_at,
     * updated_at}`; with `$detail` also `ip` and `user_agent`.
     *
     * @param  array<string, array{title: string, kind: string}>  $documents  document titles by id
     * @param  array<string, string>  $names  user names by id
     * @return array<string, mixed>
     */
    public static function submission(BuilderFormSubmission $submission, array $documents = [], array $names = [], bool $detail = false): array
    {
        // The answers in field order (jsonb doesn't keep it).
        $values = [];
        foreach ($submission->fields as $field) {
            if (array_key_exists($field['id'], $submission->values)) {
                $values[$field['id']] = $submission->values[$field['id']];
            }
        }
        $values += $submission->values;

        return [
            'id' => $submission->id,
            'document_id' => $submission->document_id,
            'element_id' => $submission->element_id,
            'form_title' => $submission->form_title,
            'document_title' => $documents[$submission->document_id]['title'] ?? null,
            // In a fixed key order (jsonb doesn't keep it).
            'fields' => array_map(fn (array $f) => ['id' => $f['id'], 'label' => $f['label'], 'kind' => $f['kind']], $submission->fields),
            'values' => $values === [] ? new stdClass : $values,
            'summary' => FormAnswers::summary($submission->fields, $values),
            'reply_to' => $submission->reply_to,
            'locale' => $submission->locale,
            'page_path' => $submission->page_path,
            'status' => $submission->status,
            'read_at' => $submission->read_at?->toIso8601String(),
            'read_by' => $submission->read_by === null ? null : ['id' => $submission->read_by, 'name' => $names[$submission->read_by] ?? null],
            'created_at' => $submission->created_at?->toIso8601String(),
            'updated_at' => $submission->updated_at?->toIso8601String(),
        ] + ($detail ? ['ip' => $submission->ip, 'user_agent' => $submission->user_agent] : []);
    }

    /**
     * User names of the submissions' readers.
     *
     * @param  iterable<BuilderFormSubmission>  $submissions
     * @return array<string, string>
     */
    public static function readerNames(iterable $submissions): array
    {
        $ids = collect($submissions)->pluck('read_by')->filter()->unique()->values()->all();

        return $ids === [] ? [] : app(UserDirectory::class)->names(app(TenantContext::class)->requireOrganization(), $ids);
    }
}
