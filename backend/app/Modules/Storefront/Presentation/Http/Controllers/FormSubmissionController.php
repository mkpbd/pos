<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Forms\FormSubmissionQueries;
use App\Modules\Storefront\Application\Forms\ManageFormSubmissions;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use App\Modules\Storefront\Presentation\Http\Exports\FormSubmissionsExport;
use App\Modules\Storefront\Presentation\Http\Support\FormSubmissionPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * B8b: what visitors sent with builder forms. Reading and exporting needs forms.view; changing
 * the status and deleting forms.manage.
 */
class FormSubmissionController
{
    /**
     * Forms
     *
     * `[{document_id, element_id, title, document_title, document_kind, total, new,
     * last_submitted_at}]`: every form element of the store's builder pages, popups and areas
     * (draft or published) and every form that has submissions (also of a deleted page:
     * `document_title` null), the most recently used first.
     */
    public function forms(FormSubmissionQueries $queries): JsonResponse
    {
        return ApiResponse::success($queries->forms());
    }

    /**
     * List form submissions
     *
     * Newest first. Filters: `form` (`<document_id>:<element_id>`), `status` (new | read |
     * archived), `search` (form title, reply-to address and answers), `from` / `to` (YYYY-MM-DD,
     * the organization's time zone). `meta.status_counts` `{new, read, archived}` for the same
     * filters without the status. `?export=csv|xlsx|pdf` exports the list (with a `form`: one
     * column per field label of that form).
     */
    public function index(Request $request, FormSubmissionQueries $queries, ListExporter $exports): Response
    {
        $filters = $request->validate([
            'form' => ['sometimes', 'nullable', 'string', 'regex:'.FormSubmissionQueries::FORM_PATTERN],
            'status' => ['sometimes', 'nullable', Rule::in(BuilderFormSubmission::STATUSES)],
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $query = $queries->list($filters);

        if ($format = ListExporter::requested($request)) {
            $fields = ($filters['form'] ?? null) === null ? null : $queries->formFields($filters['form']);

            return $exports->download(
                $request,
                $format,
                new FormSubmissionsExport($fields['fields'] ?? null, $fields['title'] ?? null),
                RowSource::fromQuery($query, fn (Collection $rows) => $rows->map(fn (BuilderFormSubmission $s) => FormSubmissionPresenter::submission($s))),
            );
        }

        $page = $query->paginate(ListQuery::perPage($request));
        $documents = $queries->documents(collect($page->items())->pluck('document_id')->all());
        $names = FormSubmissionPresenter::readerNames($page->items());

        return ApiResponse::paginated(
            $page,
            fn (BuilderFormSubmission $s) => new JsonResource(FormSubmissionPresenter::submission($s, $documents, $names)),
            ['status_counts' => $queries->statusCounts($filters)],
        );
    }

    /**
     * Show a form submission
     *
     * With `ip` and `user_agent`. Does not mark it read.
     */
    public function show(BuilderFormSubmission $submission, FormSubmissionQueries $queries): JsonResponse
    {
        return ApiResponse::success($this->detail($submission, $queries));
    }

    /**
     * Change a submission's status
     *
     * `{status: new | read | archived}`. `read` (and `archived` when not read before) records who
     * read it and when; `new` clears it. Audited.
     */
    public function update(Request $request, BuilderFormSubmission $submission, ManageFormSubmissions $manage, FormSubmissionQueries $queries): JsonResponse
    {
        $status = $request->validate(['status' => ['required', Rule::in(BuilderFormSubmission::STATUSES)]])['status'];

        return ApiResponse::success($this->detail($manage->setStatus($submission, $status), $queries));
    }

    /**
     * Delete a form submission
     *
     * Audited.
     */
    public function destroy(BuilderFormSubmission $submission, ManageFormSubmissions $manage): JsonResponse
    {
        $manage->delete($submission);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function detail(BuilderFormSubmission $submission, FormSubmissionQueries $queries): array
    {
        return FormSubmissionPresenter::submission($submission, $queries->documents([$submission->document_id]), FormSubmissionPresenter::readerNames([$submission]), true);
    }
}
